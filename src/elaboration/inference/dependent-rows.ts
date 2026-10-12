import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Err from "@yap/elaboration/shared/errors";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Src from "@yap/src/index";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";
import * as E from "fp-ts/lib/Either";
import { pipe } from "fp-ts/lib/function";

import assert from "node:assert";

type Source = R.Row<Src.Term, Src.Variable>;

const Patterns = {
	Terms: {
		Struct: { type: "struct" } as const,
	},
	Rows: {
		Empty: { type: "empty" } as const,
		Extension: { type: "extension" } as const,
		Variable: { type: "variable" } as const,
	},
};

/**
 * A row variable on either side means the shapes are not aligned field-by-field,
 * so the source is inferred whole and the two rows unified.
 */
export const check = function* (source: Source, expected: NF.Row, placeholders: NF.Row): M.Elaboration<Checked> {
	const ctx = yield* M.reader.ask();

	return yield* match([expected, source] as const)
		.with([Patterns.Rows.Empty, Patterns.Rows.Empty], () =>
			M.of<Checked>({ term: R.Constructors.Empty<EB.Term, EB.Variable>(), usages: Q.noUsage(ctx.env.length), references: {} }),
		)
		.with([Patterns.Rows.Extension, Patterns.Rows.Extension], ([exp, src]) =>
			pipe(
				E.Do,
				E.apS("field", R.rewrite(src, exp.label)),
				E.apS("slot", R.rewrite(placeholders, exp.label)),
				E.match(
					() => M.fail(Err.MissingLabel(exp.label, src)),
					function* ({ field, slot }): M.Elaboration<Checked> {
						assert(field.type === "extension" && slot.type === "extension", "A rewritten row begins with the requested label");

						const [[term, usages], references, rest] = yield* scoped(
							exp.label,
							function* () {
								const checked = yield* EB.check(field.value, exp.value);
								yield* M.constrain({ type: "assign", left: exp.value, right: slot.value, lvl: ctx.env.length });
								return checked;
							},
							() => check(field.row, exp.row, slot.row),
						);

						return {
							term: R.Constructors.Extension(exp.label, term, rest.term),
							usages: Q.add(usages, rest.usages),
							references: { [exp.label]: references, ...rest.references },
						};
					},
				),
			),
		)
		.with([Patterns.Rows.Variable, Patterns.Rows.Empty], [Patterns.Rows.Variable, Patterns.Rows.Extension], function* ([, src]) {
			const inferred = yield* infer(src, placeholders);
			yield* M.constrain({ type: "assign", left: NF.Constructors.Row(inferred.type), right: NF.Constructors.Row(expected), lvl: ctx.env.length });

			return inferred;
		})
		.with([Patterns.Rows.Empty, Patterns.Rows.Variable], function* () {
			return yield* M.fail(Err.Impossible("Dependent value row cannot have a tail variable"));
		})
		.with([Patterns.Rows.Extension, Patterns.Rows.Variable], ([exp, src]) => M.fail(Err.MissingLabel(exp.label, src)))
		.with([Patterns.Rows.Empty, Patterns.Rows.Extension], ([, src]) => M.fail(Err.MissingLabel(src.label, expected)))
		.otherwise(function* () {
			return yield* M.fail(Err.Impossible("Dependent checking row reached incompatible shapes"));
		});
};

type Checked = Omit<Inferred, "type">;

type Inferred = {
	term: EB.Row;
	type: NF.Row;
	usages: Q.Usages;
	references: References;
};

export const infer = function* (source: Source, placeholders: NF.Row): M.Elaboration<Inferred> {
	return yield* match([source, placeholders] as const)
		.with([Patterns.Rows.Extension, Patterns.Rows.Extension], function* ([src, slot]) {
			const [[term, type, usages], references, rest] = yield* scoped(
				src.label,
				function* () {
					const ast = yield* EB.infer(src.value);
					const ctx = yield* M.reader.ask();
					yield* M.constrain({ type: "assign", left: ast[1], right: slot.value, lvl: ctx.env.length });
					return ast;
				},
				() => infer(src.row, slot.row),
			);

			return {
				term: R.Constructors.Extension(src.label, term, rest.term),
				type: R.Constructors.Extension(src.label, type, rest.type),
				usages: Q.add(usages, rest.usages),
				references: { [src.label]: references, ...rest.references },
			} satisfies Inferred;
		})
		.with([Patterns.Rows.Variable, Patterns.Rows.Variable], function* ([src, slot]) {
			const ctx = yield* M.reader.ask();
			const [term, type, usages] = yield* EB.lookup(src.variable, ctx);
			assert(term.type === "Var", "Dependent row tails must elaborate to variables");

			/* The tail's own type is a struct over the remaining slots, however it is presented. */
			yield* match(type)
				.with(NF.Patterns.Schema, function* ({ arg }) {
					yield* M.constrain({ type: "assign", left: arg, right: NF.Constructors.Row(slot), lvl: ctx.env.length });
				})
				.with(NF.Patterns.Flex, function* () {
					yield* M.constrain({ type: "assign", left: type, right: NF.Constructors.Schema(slot), lvl: ctx.env.length });
				})
				.otherwise(function* () {
					return yield* M.fail(Err.Impossible("Dependent value row tail must have a struct type"));
				});

			return { term: R.Constructors.Variable(term.variable), type: slot, usages, references: {} } satisfies Inferred;
		})
		.with([Patterns.Rows.Variable, Patterns.Rows.Empty], [Patterns.Rows.Variable, Patterns.Rows.Extension], function* () {
			return yield* M.fail(Err.Impossible("Dependent value row cannot have a tail variable"));
		})
		.otherwise(function* () {
			const ctx = yield* M.reader.ask();

			return {
				term: R.Constructors.Empty<EB.Term, EB.Variable>(),
				type: R.Constructors.Empty<NF.Value, NF.Variable>(),
				usages: Q.noUsage(ctx.env.length),
				references: {},
			} satisfies Inferred;
		});
};

export const fields = function* (source: Source): M.Elaboration<[EB.Row, Q.Usages]> {
	return yield* match(source)
		.with(Patterns.Rows.Empty, function* () {
			const ctx = yield* M.reader.ask();

			return [R.Constructors.Empty<EB.Term, EB.Variable>(), Q.noUsage(ctx.env.length)] satisfies [EB.Row, Q.Usages];
		})
		.with(Patterns.Rows.Extension, function* ({ label, value, row }) {
			const [term, usages] = yield* match(value)
				.with(Patterns.Terms.Struct, () => EB.check(value, NF.Type))
				.otherwise(function* () {
					const [term, , usages] = yield* EB.infer(value);
					return [term, usages] as const;
				});
			const [rest, restUsages] = yield* fields(row);

			return [R.Constructors.Extension(label, term, rest), Q.add(usages, restUsages)] satisfies [EB.Row, Q.Usages];
		})
		.with(Patterns.Rows.Variable, function* ({ variable }) {
			const ctx = yield* M.reader.ask();
			const [term, type, usages] = yield* EB.lookup(variable, ctx);
			assert(term.type === "Var", "Dependent row tails must elaborate to variables");
			yield* M.constrain({ type: "assign", left: type, right: NF.Row, lvl: ctx.env.length });

			return [R.Constructors.Variable(term.variable), usages] satisfies [EB.Row, Q.Usages];
		})
		.exhaustive();
};

export const prepare = (source: Source, lvl: number): M.Elaboration<EB.Row> =>
	shaped(source, lvl, function* () {
		return EB.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
	});

/**
 * Elaborating a sigma row is similar to toplevel mutual definitions which are typically solved with a 2-phase approach: first prepare the row with placeholders, then elaborate the actual fields.
 * The Sigma binder is just a mechanism to allow these 2 phases and so its annotation only neds to care about the labels themselves.
 * As such, the placeholders are filled with Irrelevant values, which have no computational or semantic meaning other than filling the positions in the row.
 */
export const placeholders = (source: Source, lvl: number): M.Elaboration<EB.Row> =>
	shaped(source, lvl, () => M.of<EB.Term>(EB.Constructors.Lit({ type: "Atom", value: "Irrelevant" })));

/** Built from the source so the labels agree by construction and the walkers above descend both rows in step. */
const shaped = function* (source: Source, _lvl: number, slot: () => M.Elaboration<EB.Term>): M.Elaboration<EB.Row> {
	return yield* match(source)
		.with(Patterns.Rows.Empty, () => M.of<EB.Row>(R.Constructors.Empty<EB.Term, EB.Variable>()))
		.with(Patterns.Rows.Extension, function* ({ label, row }) {
			return R.Constructors.Extension<EB.Term, EB.Variable>(label, yield* slot(), yield* shaped(row, _lvl, slot));
		})
		.with(Patterns.Rows.Variable, () => M.of<EB.Row>(R.Constructors.Empty<EB.Term, EB.Variable>()))
		.exhaustive();
};

export const witness = function* (row: EB.Row): M.Elaboration<NF.Row> {
	const value = yield* NF.normalize(EB.Constructors.Row(row));
	assert(value.type === "Row", "A prepared row must normalize to a row");

	return value.row;
};

type References = Record<string, readonly EB.Reference[]>;

/** Elaborates one field inside its own reference window; the remaining fields then see its term in the frame. */
const scoped = function* <A extends readonly [EB.Term, ...unknown[]], B>(label: string, elaborate: () => M.Elaboration<A>, rest: () => M.Elaboration<B>) {
	const ctx = yield* M.reader.ask();
	const [elaborated, references] = yield* M.windows.within<EB.Reference>()({ scope: "local", lvl: ctx.local.length - 1 }, elaborate);
	const [frame, ...outer] = ctx.local;
	const remaining = yield* M.reader.local(
		c => ({ ...c, local: [{ ...frame, terms: R.Constructors.Extension(label, elaborated[0], frame.terms) }, ...outer] }),
		rest(),
	);

	return [elaborated, references, remaining] as const;
};

export const labels = (row: Source): string[] =>
	match(row)
		.with(Patterns.Rows.Extension, ({ label, row }) => [label, ...labels(row)])
		.otherwise(() => []);

/** Elaborates a strict record's fields under its own frame on the label stack, then closes it. */
export const nu = function* <A>(row: Source, elaborate: (slots: NF.Row) => M.Elaboration<A & { term: EB.Row; references: References }>) {
	const ctx = yield* M.reader.ask();
	const slots = yield* witness(yield* prepare(row, ctx.env.length));
	const frame: EB.Frame = { labels: labels(row), ctx, slots, terms: R.Constructors.Empty() };

	const elaborated = yield* M.reader.local(c => ({ ...c, local: [frame, ...c.local] }), elaborate(slots));
	yield* acyclic(elaborated.references);

	/* A `$label` met before its field was elaborated stands in as a value meta. That meta is not an
	 * unknown to infer: its solution is the field's value, known now that every field has a term,
	 * so it is written directly rather than posed as a constraint. */
	const complete = { ...frame, terms: elaborated.term };
	yield* M.traverse(
		Object.values(elaborated.references).flatMap(refs => refs.flatMap(({ label, meta }) => (meta ? [{ label, meta }] : []))),
		function* ({ label, meta }) {
			const term = R.lookup(elaborated.term, label);
			assert(term, "A referenced label names a field of its record");

			const value = yield* M.reader.local(_ => ({ ...ctx, local: [complete, ...ctx.local] }), NF.normalize(term));
			yield* Metas.registry.modify(r => Metas.solve(r, meta.val, value));
		},
	);

	const referenced = new Set(Object.values(elaborated.references).flatMap(refs => refs.map(({ label }) => label)));
	const binder = { mode: "strict", labels: frame.labels, scoped: requested(elaborated.term, referenced) } as const;

	return [binder, elaborated] as const;
};

/** OCaml's `let rec` check: a field may not be called, nor read in a cycle, outside a lambda. */
const acyclic = function* (references: References): M.Elaboration<void> {
	const unguarded = Object.fromEntries(Object.entries(references).map(([label, refs]) => [label, refs.filter(({ guarded }) => !guarded)]));
	const call = Object.values(unguarded)
		.flat()
		.find(({ applied }) => applied);
	if (call) {
		return yield* M.fail(Err.RecordCall(call.label));
	}

	const found = cycle(Object.fromEntries(Object.entries(unguarded).map(([label, refs]) => [label, refs.map(ref => ref.label)])));
	if (found) {
		return yield* M.fail(Err.RecordCycle(found));
	}
};

const cycle = (edges: Record<string, readonly string[]>): string[] | undefined => {
	const visit = (label: string, path: readonly string[]): string[] | undefined =>
		path.includes(label) ? [...path.slice(path.indexOf(label)), label] : edges[label]?.map(next => visit(next, [...path, label])).find(Boolean);

	return Object.keys(edges)
		.map(label => visit(label, []))
		.find(Boolean);
};

const requested = (row: EB.Row, names: ReadonlySet<string>): EB.Row =>
	match(row)
		.with(Patterns.Rows.Extension, ({ label, value, row }) =>
			names.has(label) ? R.Constructors.Extension(label, value, requested(row, names)) : requested(row, names),
		)
		.otherwise(() => R.Constructors.Empty<EB.Term, EB.Variable>());
