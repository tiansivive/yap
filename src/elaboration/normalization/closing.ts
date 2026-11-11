/*
 * Readback substitutes a source closure's captured values while preserving pending code and its binders.
 * Recursive captures retain typed lets; record fields retain their defining label frames.
 * Design: z-yap/zettels/effect-identities.design.md. EB is elaborated syntax; NF is a semantic value.
 */
import assert from "node:assert";
import { isMatching, match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as R from "@yap/shared/rows";
import * as NF from "./syntax/term";
import { Do, group, result, type Evaluation, type Machine } from "./effects";
import { quote } from "./quoting";
import { referenced } from "./computation-traversal";

export function* close(lvl: number, source: Pick<NF.Source, "ctx" | "term">): Evaluation<Machine<EB.Term>> {
	return yield* visit(source.term, initial(lvl, source.ctx, yield* M.reader.ask()));
}

export function* value(lvl: number, source: { ctx: EB.Context; value: NF.Value }): Evaluation<Machine<EB.Term>> {
	return yield* semantic(source.value, initial(lvl, source.ctx, yield* M.reader.ask()));
}

export function* annotation(lvl: number, source: { ctx: EB.Context; value: NF.Value }): Evaluation<Machine<NF.Value>> {
	return yield* annotate(source.value, initial(lvl, source.ctx, yield* M.reader.ask()));
}

type Scope = { lvl: number; depth: number; labels: number; source: EB.Context; target: EB.Context; bindings: ReadonlyMap<EB.Context["env"][number], number> };

const initial = (lvl: number, source: EB.Context, target: EB.Context): Scope => ({
	lvl,
	depth: 0,
	labels: 0,
	bindings: new Map(),
	source,
	target: { ...target, env: Array.from({ length: lvl }, (_, index) => rigid(lvl - index - 1)) },
});

function* visit(term: EB.Term, scope: Scope): Evaluation<Machine<EB.Term>> {
	const recur = (term: EB.Term, within = scope) => visit(term, within);
	return yield* match(term)
		.with(EB.CtorPatterns.Vars.Bound, ({ variable }) => {
			if (variable.index < scope.depth) {
				return result(term);
			}
			const entry = scope.source.env[variable.index];
			assert(entry, "A captured reference has an environment entry");
			return capture(entry, scope);
		})
		.with(EB.CtorPatterns.Vars.DepLabel, ({ variable }) => {
			if (variable.index < scope.depth) {
				return Do.let("type", annotate(variable.annotation, scope)).in(({ type }) => result(EB.Constructors.Var({ ...variable, annotation: type })));
			}
			const entry = scope.source.env[variable.index];
			assert(entry, "A captured field reference has an environment entry");
			return Do.let("base", capture(entry, scope)).in(({ base }) => result(EB.Constructors.Proj(variable.name, base)));
		})
		.with(EB.CtorPatterns.Vars.NuLabel, ({ variable }) => {
			if (variable.index < scope.labels) {
				return Do.let("type", annotate(variable.annotation, scope)).in(({ type }) => result(EB.Constructors.Var({ ...variable, annotation: type })));
			}
			const frame = scope.source.local[variable.index];
			assert(frame, "A captured field reference has a label frame");
			const index = scope.target.local.indexOf(frame);

			if (index >= 0) {
				return Do.let("type", annotate(variable.annotation, scope)).in(({ type }) => result(EB.Constructors.Var({ ...variable, index, annotation: type })));
			}
			if (frame.source) {
				/* The captured frame represents an opened record, so readback enters its field scope directly. */
				const term = EB.Constructors.Nu({ ...frame.source, mode: "strict", scoped: frame.terms }, EB.Constructors.Var({ ...variable, index: 0 }));
				return visit(term, { ...scope, source: frame.ctx, depth: 0, labels: 0 });
			}
			const field = R.lookup(frame.terms, variable.name);
			assert(field, "An escaping field reference retains its source term");
			return visit(field, { ...scope, source: EB.enter(frame), depth: 0, labels: 0 });
		})
		.with({ type: "Var", variable: { type: "Label" } }, ({ variable }) => {
			const value = scope.source.sigma[variable.name]?.value ?? scope.source.record[variable.name]?.value;
			const source = scope.source.record[variable.name]?.term;

			if (value) {
				return semantic(value, scope);
			}
			return source ? recur(source) : result(term);
		})
		.with(EB.CtorPatterns.Var, EB.CtorPatterns.Lit, () => result(term))
		.with(EB.CtorPatterns.Nu, ({ binding, body }) => {
			const held = {
				...scope,
				labels: scope.labels + 1,
				source: EB.open({ ...binding, scoped: R.Constructors.Empty() }, scope.source),
				target: EB.open({ ...binding, scoped: R.Constructors.Empty() }, scope.target),
			};
			return Do.let("annotation", recur(binding.annotation, held))
				.let("scoped", row(binding.scoped, held))
				.let("body", recur(body, held))
				.in(({ annotation, scoped, body }) => result(EB.Constructors.Abs({ ...binding, annotation, scoped }, body)));
		})
		.with(EB.CtorPatterns.Sigma, ({ binding, body }) => {
			assert(isMatching(EB.CtorPatterns.Row, binding.annotation), "A Sigma annotation is a row");
			const labels: NF.Row = R.Constructors.Row(
				binding.annotation.row.entries.map(({ label }) => ({ label, value: NF.Constructors.Var({ type: "Label", name: label }) })),
			);
			const held = { ...scope, source: EB.extendSigma(scope.source, labels) };
			return Do.let("annotation", recur(binding.annotation, held))
				.let("body", recur(body, held))
				.in(({ annotation, body }) => result(EB.Constructors.Abs({ ...binding, annotation }, body)));
		})
		.with({ type: "Abs", binding: { type: "Let" } }, ({ binding, body }) => {
			const held = bind(scope, binding);
			return Do.let("annotation", recur(binding.annotation))
				.let("value", recur(binding.value, held))
				.let("body", recur(body, held))
				.in(({ annotation, value, body }) => result(EB.Constructors.Abs({ ...binding, annotation, value }, body)));
		})
		.with({ type: "Abs" }, ({ binding, body }) =>
			Do.let("annotation", recur(binding.annotation))
				.let("body", recur(body, bind(scope, binding)))
				.in(({ annotation, body }) => result(EB.Constructors.Abs({ ...binding, annotation }, body))),
		)
		.with({ type: "App" }, ({ icit, func, arg }) =>
			Do.let("func", recur(func))
				.let("arg", recur(arg))
				.in(({ func, arg }) => result(EB.Constructors.App(icit, func, arg))),
		)
		.with(EB.CtorPatterns.Row, term => Do.let("row", row(term.row, scope)).in(({ row }) => result(EB.Constructors.Row(row))))
		.with(EB.CtorPatterns.Proj, ({ label, term }) => Do.let("term", recur(term)).in(({ term }) => result(EB.Constructors.Proj(label, term))))
		.with(EB.CtorPatterns.Inj, ({ label, value, term }) =>
			Do.let("value", recur(value))
				.let("term", recur(term))
				.in(({ value, term }) => result(EB.Constructors.Inj(label, value, term))),
		)
		.with(EB.CtorPatterns.Ann, ({ term, ann }) =>
			Do.let("term", recur(term))
				.let("ann", recur(ann))
				.in(({ term, ann }) => result(EB.Constructors.Ann(term, ann))),
		)
		.with(EB.CtorPatterns.Match, ({ scrutinee, alternatives }) =>
			Do.let("scrutinee", recur(scrutinee))
				.let(
					"alternatives",
					group(
						alternatives.map(alt => alternative(alt, scope)),
						result,
					),
				)
				.in(({ scrutinee, alternatives }) => result(EB.Constructors.Match(scrutinee, alternatives))),
		)
		.with({ type: "Block" }, ({ statements, return: term }) => block(statements, term, scope))
		.with({ type: "Reset", handling: P.nonNullable }, ({ term, handling }) =>
			Do.let("identity", recur(handling.identity))
				.let("handler", recur(handling.handler))
				.let("term", recur(term))
				.in(({ identity, handler, term }) => result(EB.Constructors.Reset(term, { identity, handler }))),
		)
		.with({ type: "Reset" }, ({ term }) => Do.let("term", recur(term)).in(({ term }) => result(EB.Constructors.Reset(term))))
		.with({ type: "Suspend" }, ({ identity, payload, annotation }) =>
			Do.let("identity", recur(identity))
				.let("payload", recur(payload))
				.let("annotation", recur(annotation))
				.in(({ identity, payload, annotation }) => result(EB.Constructors.Suspend(identity, payload, annotation))),
		)
		.with({ type: "Shift" }, ({ body }) => Do.let("body", recur(body)).in(({ body }) => result(EB.Constructors.Shift(body))))
		.with(EB.CtorPatterns.Bubble, term =>
			Do.let("ann", annotate(term.ann, scope))
				.let(
					"values",
					group(
						term.values.map(value => annotate(value, scope)),
						result,
					),
				)
				.let("shift", recur(term.shift))
				.in(({ ann, values, shift }) => result(EB.Constructors.Bubble(term.meta, ann, values, shift))),
		)
		.with({ type: "Modal" }, ({ term, modalities }) =>
			Do.let("term", recur(term))
				.let("liquid", recur(modalities.liquid))
				.in(({ term, liquid }) => result(EB.Constructors.Modal(term, { ...modalities, liquid }))),
		)
		.exhaustive();
}

function* capture(entry: EB.Context["env"][number], scope: Scope): Evaluation<Machine<EB.Term>> {
	const level = scope.bindings.get(entry);

	if (level !== undefined) {
		return yield* result(EB.Constructors.Var({ type: "Bound", index: scope.lvl - level - 1 }));
	}
	return yield* match([entry.name, entry.nf])
		.with(
			[{ type: "Let" }, { type: P.union("Abs", "Row") }],
			([, value]) => recursive(value),
			function* ([binder, value]) {
				const held = { ...bind(scope, binder), bindings: new Map([...scope.bindings, [entry, scope.lvl]]) };
				return yield* Do.let("annotation", annotate(entry.type[2], scope))
					.let("value", semantic(value, held))
					.in(({ annotation, value }) =>
						result(EB.Constructors.Block([EB.Constructors.Stmt.Let(binder.variable, value, annotation)], EB.Constructors.Var({ type: "Bound", index: 0 }))),
					);
			},
		)
		.otherwise(() => semantic(entry.nf, scope));
}

const recursive = (root: NF.Value): boolean => {
	const visit = (value: NF.Value, seen: ReadonlySet<NF.Value>): boolean => {
		if (seen.has(value)) {
			return false;
		}
		const children = match(value)
			.with({ type: "Abs", closure: { type: "Closure" } }, ({ binder, closure }) => [
				binder.annotation,
				...referenced(closure, isMatching({ type: P.union("Sigma", "Nu") }, binder) ? 0 : 1),
			])
			.with(NF.Patterns.Row, ({ row }) => row.entries.map(({ value }) => value))
			.with(NF.Patterns.App, ({ func, arg }) => [func, arg])
			.with(NF.Patterns.Neutral, ({ value }) => [value])
			.with(NF.Patterns.Glued, ({ folded }) => [folded])
			.with(NF.Patterns.Modal, ({ value, modalities }) => [value, modalities.liquid])
			.otherwise(() => []);
		return children.some(child => child === root || visit(child, new Set([...seen, value])));
	};
	return visit(root, new Set());
};

function* semantic(value: NF.Value, scope: Scope): Evaluation<Machine<EB.Term>> {
	const recur = (value: NF.Value) => semantic(value, scope);
	return yield* match(value)
		.with(NF.Patterns.Neutral, ({ value }) => recur(value))
		.with(NF.Patterns.Glued, ({ folded }) => recur(folded))
		.with(NF.Patterns.NuLabel, ({ variable }) => visit(EB.Constructors.Var({ ...variable, index: scope.source.local.length - variable.lvl - 1 }), scope))
		.with(NF.Patterns.Flex, function* ({ variable }) {
			const solution = Metas.solution(yield* Metas.registry.get(), variable.val);
			return yield* solution ? recur(solution) : result(EB.Constructors.Var(variable));
		})
		.with(NF.Patterns.Deferred, ({ source }) => visit(source.term, { ...scope, source: source.ctx, depth: 0, labels: 0 }))
		.with(NF.Patterns.Nu, ({ binder, closure }) => {
			assert(isMatching({ type: "Closure" }, closure), "A captured record retains its source closure");
			const source = EB.open({ ...binder, scoped: R.Constructors.Empty() }, closure.ctx, binder.source);
			const held = { ...scope, source, depth: 0, labels: 1, target: EB.open({ ...binder, scoped: R.Constructors.Empty() }, scope.target) };
			return Do.let("annotation", semantic(binder.annotation, held))
				.let("scoped", row(binder.scoped, held))
				.let("body", visit(closure.term, held))
				.in(({ annotation, scoped, body }) => result(EB.Constructors.Nu({ ...binder, annotation, scoped }, body)));
		})
		.with({ type: "Abs", closure: { type: "Closure" } }, ({ binder, closure }) => {
			const held = { ...scope, source: closure.ctx, depth: 0, labels: 0 };
			return Do.let("annotation", semantic(binder.annotation, held))
				.let("body", visit(closure.term, isMatching({ type: "Sigma" }, binder) ? held : bind(held, binder)))
				.in(({ annotation, body }) => result(EB.Constructors.Abs({ ...binder, annotation }, body)));
		})
		.with(NF.Patterns.App, ({ func, arg, icit }) =>
			Do.let("func", recur(func))
				.let("arg", recur(arg))
				.in(({ func, arg }) => result(EB.Constructors.App(icit, func, arg))),
		)
		.with(NF.Patterns.Proj, ({ base, label }) => Do.let("base", recur(base)).in(({ base }) => result(EB.Constructors.Proj(label, base))))
		.with(NF.Patterns.Inj, ({ base, label, injected }) =>
			Do.let("base", recur(base))
				.let("value", recur(injected))
				.in(({ base, value }) => result(EB.Constructors.Inj(label, value, base))),
		)
		.with(NF.Patterns.Match, ({ scrutinee, closure }) => {
			assert(isMatching({ type: "Closure", term: EB.CtorPatterns.Match }, closure), "A captured match retains its alternatives");
			return Do.let("scrutinee", recur(scrutinee))
				.let(
					"alternatives",
					group(
						closure.term.alternatives.map(alt => alternative(alt, { ...scope, source: closure.ctx, depth: 0, labels: 0 })),
						result,
					),
				)
				.in(({ scrutinee, alternatives }) => result(EB.Constructors.Match(scrutinee, alternatives)));
		})
		.with(NF.Patterns.Row, ({ row }) =>
			Do.let(
				"entries",
				group(
					row.entries.map(({ value }) => recur(value)),
					result,
				),
			)
				.let("tail", row.tail ? recur(NF.Constructors.Var(row.tail)) : result(EB.Constructors.Row(R.Constructors.Empty())))
				.in(({ entries, tail }) => {
					const rest = match(tail)
						.with(EB.CtorPatterns.Var, ({ variable }) => R.Constructors.Variable<EB.Term, EB.Variable>(variable))
						.with(EB.CtorPatterns.Row, ({ row }) => row)
						.otherwise(() => {
							throw new Error("A semantic row tail reads back as a row or reference");
						});
					return result(
						EB.Constructors.Row(R.Constructors.Row([...row.entries.map(({ label }, index) => ({ label, value: entries[index] })), ...rest.entries], rest.tail)),
					);
				}),
		)
		.with(NF.Patterns.Modal, ({ value, modalities }) =>
			Do.let("value", recur(value))
				.let("liquid", recur(modalities.liquid))
				.in(({ value, liquid }) => result(EB.Constructors.Modal(value, { ...modalities, liquid }))),
		)
		.with(NF.Patterns.Suspend, ({ identity, signature, payload, annotation }) =>
			Do.let("identity", recur(identity))
				.let("signature", signature ? recur(signature) : result<EB.Term | undefined>(undefined))
				.let("payload", recur(payload))
				.let("annotation", recur(annotation))
				.in(({ identity, signature, payload, annotation }) =>
					result(EB.Constructors.Suspend(signature ? EB.Constructors.Ann(identity, signature) : identity, payload, annotation)),
				),
		)
		.with({ type: "External" }, ({ name, args }) =>
			group(args.map(recur), args =>
				result(args.reduce((func, arg) => EB.Constructors.App("Explicit", func, arg), EB.Constructors.Var({ type: "Foreign", name }))),
			),
		)
		.otherwise(() => M.reader.local(_ => scope.target, quote(scope.lvl, value)));
}

const rigid = (lvl: number): EB.Context["env"][number] => ({
	nf: NF.Constructors.Rigid(lvl),
	name: { type: "Lambda", variable: "$quote" },
	type: [{ type: "Lambda", variable: "$quote" }, "inserted", NF.Type],
});

const bind = (scope: Scope, binder: EB.Binder): Scope => ({
	...scope,
	lvl: scope.lvl + 1,
	depth: scope.depth + 1,
	source: EB.bind(scope.source, binder, NF.Type),
	target: EB.bind(scope.target, binder, NF.Type),
});

function* annotate(value: NF.Value, scope: Scope): Evaluation<Machine<NF.Value>> {
	return yield* Do.let(
		"quoted",
		M.reader.local(_ => scope.source, quote(scope.source.env.length, value)),
	).in(({ quoted }) => Do.let("term", visit(quoted, scope)).in(({ term }) => result(NF.Constructors.Deferred({ ctx: scope.target, term }))));
}

function* row(value: EB.Row, scope: Scope): Evaluation<Machine<EB.Row>> {
	return yield* Do.let(
		"entries",
		group(
			value.entries.map(({ value }) => visit(value, scope)),
			result,
		),
	)
		.let("tail", value.tail ? visit(EB.Constructors.Var(value.tail), scope) : result(EB.Constructors.Row(R.Constructors.Empty())))
		.in(({ entries, tail }) => {
			const rest = match(tail)
				.with(EB.CtorPatterns.Var, ({ variable }) => R.Constructors.Variable<EB.Term, EB.Variable>(variable))
				.with(EB.CtorPatterns.Row, ({ row }) => row)
				.otherwise(() => {
					throw new Error("A captured row tail closes to a row or reference");
				});
			return result(R.Constructors.Row([...value.entries.map(({ label }, index) => ({ label, value: entries[index] })), ...rest.entries], rest.tail));
		});
}

function* block(statements: EB.Statement[], term: EB.Term, scope: Scope): Evaluation<Machine<EB.Term>> {
	const [first, ...rest] = statements;

	if (!first) {
		return yield* Do.let("term", visit(term, scope)).in(({ term }) => result(EB.Constructors.Block([], term)));
	}
	const held = match(first)
		.with({ type: "Let" }, value => bind(scope, value))
		.otherwise(() => scope);
	return yield* Do.let("value", visit(first.value, held))
		.let(
			"annotation",
			match(first)
				.with({ type: "Expression" }, () => result(undefined))
				.otherwise(value => annotate(value.annotation, scope)),
		)
		.let("following", block(rest, term, held))
		.in(({ value, annotation, following }) => {
			const statement = match(first)
				.with({ type: "Expression" }, () => ({ ...first, value }))
				.otherwise(first => {
					assert(annotation);
					return { ...first, value, annotation };
				});
			return result(
				match(following)
					.with({ type: "Block" }, ({ statements, return: term }) => EB.Constructors.Block([statement, ...statements], term))
					.otherwise(() => {
						throw new Error("A statement sequence retains its block");
					}),
			);
		});
}

function* alternative(alt: EB.Alternative, scope: Scope): Evaluation<Machine<EB.Alternative>> {
	return yield* Do.let("pattern", pattern(alt.pattern, scope))
		.let(
			"binders",
			group(
				alt.binders.map(([name, value]) => Do.let("type", annotate(value, scope)).in(({ type }) => result<[string, NF.Value]>([name, type]))),
				result,
			),
		)
		.let(
			"term",
			visit(
				alt.term,
				alt.binders.reduce((held, [variable]) => bind(held, { type: "Pattern", variable }), scope),
			),
		)
		.in(({ pattern, binders, term }) => result({ pattern, binders, term }));
}

function* pattern(value: EB.Pattern, scope: Scope): Evaluation<Machine<EB.Pattern>> {
	return yield* match(value)
		.with({ type: "Var" }, value => Do.let("term", visit(value.term, scope)).in(({ term }) => result({ ...value, term })))
		.with({ type: P.union("Row", "Struct", "Variant") }, value =>
			group(
				value.row.entries.map(({ value }) => pattern(value, scope)),
				values =>
					result({
						...value,
						row: R.Constructors.Row(
							value.row.entries.map(({ label }, index) => ({ label, value: values[index] })),
							value.row.tail,
						),
					}),
			),
		)
		.with({ type: "List" }, value =>
			group(
				value.patterns.map(value => pattern(value, scope)),
				patterns => result({ ...value, patterns }),
			),
		)
		.otherwise(value => result(value));
}
