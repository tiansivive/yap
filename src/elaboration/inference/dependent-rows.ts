import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Err from "@yap/elaboration/shared/errors";
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
export const check = function* (source: Source, expected: NF.Row, placeholders: NF.Row): M.Elaboration<[EB.Row, Q.Usages]> {
	const ctx = yield* M.reader.ask();

	return yield* match([expected, source] as const)
		.with([Patterns.Rows.Empty, Patterns.Rows.Empty], () => M.of<[EB.Row, Q.Usages]>([R.Constructors.Empty<EB.Term, EB.Variable>(), Q.noUsage(ctx.env.length)]))
		.with([Patterns.Rows.Extension, Patterns.Rows.Extension], ([exp, src]) =>
			pipe(
				E.Do,
				E.apS("field", R.rewrite(src, exp.label)),
				E.apS("slot", R.rewrite(placeholders, exp.label)),
				E.match(
					() => M.fail(Err.MissingLabel(exp.label, src)),
					function* ({ field, slot }): M.Elaboration<[EB.Row, Q.Usages]> {
						assert(field.type === "extension" && slot.type === "extension", "A rewritten row begins with the requested label");

						const [term, fieldUsages] = yield* EB.check(field.value, exp.value);
						yield* M.constrain({ type: "assign", left: exp.value, right: slot.value, lvl: ctx.env.length });

						const [row, rest] = yield* check(field.row, exp.row, slot.row);

						return [R.Constructors.Extension(exp.label, term, row), Q.add(fieldUsages, rest)];
					},
				),
			),
		)
		.with([Patterns.Rows.Variable, Patterns.Rows.Empty], [Patterns.Rows.Variable, Patterns.Rows.Extension], function* ([, src]) {
			const inferred = yield* infer(src, placeholders);
			yield* M.constrain({ type: "assign", left: NF.Constructors.Row(inferred.type), right: NF.Constructors.Row(expected), lvl: ctx.env.length });

			return [inferred.term, inferred.usages] satisfies [EB.Row, Q.Usages];
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

type Inferred = {
	term: EB.Row;
	type: NF.Row;
	usages: Q.Usages;
};

export const infer = function* (source: Source, placeholders: NF.Row): M.Elaboration<Inferred> {
	return yield* match([source, placeholders] as const)
		.with([Patterns.Rows.Extension, Patterns.Rows.Extension], function* ([src, slot]) {
			const [term, type, usages] = yield* EB.infer(src.value);
			const ctx = yield* M.reader.ask();
			yield* M.constrain({ type: "assign", left: type, right: slot.value, lvl: ctx.env.length });

			const rest = yield* infer(src.row, slot.row);

			return {
				term: R.Constructors.Extension(src.label, term, rest.term),
				type: R.Constructors.Extension(src.label, type, rest.type),
				usages: Q.add(usages, rest.usages),
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

			return { term: R.Constructors.Variable(term.variable), type: slot, usages } satisfies Inferred;
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
