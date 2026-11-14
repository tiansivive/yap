import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as NF from "./syntax/term";
import * as R from "@yap/shared/rows";
import { display } from "./syntax/pretty";
import { Do, group, result, scope, type Evaluation, type Machine } from "./effects";
import { schedule } from "./evaluation.v2";
import * as NbE from "./nbe";
import * as Stack from "./machine/actions";
import type { Scope, Handling } from "./effects";
import { match, P } from "ts-pattern";
import assert from "node:assert";

const symbolicRow = (annotation: NF.Value): NF.Row => {
	assert(annotation.type === "Row", "Sigma annotation should be a Row");
	return R.Constructors.Row(
		annotation.row.entries.map(({ label }) => ({ label, value: NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: label })) })),
		annotation.row.tail,
	);
};

/**
 * Quotes a value at the given level, under the ambient context.
 * We explicitly pass the level to avoid extending the context when quoting under binders.
 * Closure bodies quote under their own stored context — closure consumption, via reader.local.
 *
 * Glue reads back as the reference it came from. Unfolding definitions reads back what references
 * compute instead, at every depth, which is what showing a normal form means.
 */
export const quote = (lvl: number, val: NF.Value, unfold: NF.Unfolding = "none"): Evaluation<Machine<EB.Term>> => quoting(lvl, val, unfold, new Map());

function* quoting(lvl: number, val: NF.Value, unfold: NF.Unfolding, levels: ReadonlyMap<number, number>): Evaluation<Machine<EB.Term>> {
	return yield* match(val)
		.with(NF.Patterns.Glued, ({ folded, unfolded }) => quoting(lvl, unfold === "definitions" ? unfolded : folded, unfold, levels))
		.with({ type: "Lit" }, function* ({ value }) {
			return yield* result(EB.Constructors.Lit(value));
		})
		.with({ type: "Var" }, function* ({ variable }) {
			return yield* match(variable)
				.with({ type: "Bound" }, function* (v) {
					return yield* result(EB.Constructors.Var({ type: "Bound", index: lvl - (levels.get(v.lvl) ?? v.lvl) - 1 }));
				})
				.with({ type: "DepLabel" }, function* (v) {
					return yield* result(
						EB.Constructors.Var({ type: "DepLabel", name: v.name, index: lvl - (levels.get(v.lvl) ?? v.lvl) - 1, annotation: v.annotation }),
					);
				})
				.with({ type: "NuLabel" }, function* (v) {
					const { local } = yield* M.reader.ask();
					return yield* result(EB.Constructors.Var({ type: "NuLabel", name: v.name, index: local.length - v.lvl - 1, annotation: v.annotation }));
				})
				.with({ type: "Meta" }, function* (v) {
					const solved = Metas.solution(yield* Metas.registry.get(), v.val);

					return yield* solved ? quoting(lvl, solved, unfold, levels) : result(EB.Constructors.Var(v));
				})
				.otherwise(function* (v) {
					return yield* result(EB.Constructors.Var(v));
				});
		})

		.with(NF.Patterns.StuckMatch, function* ({ value: { closure, scrutinee } }) {
			assert(closure.type === "Closure", "Blocked match should retain a term closure");
			assert(closure.term.type === "Match", "Blocked match closure should retain a match term");

			const alternatives = closure.term.alternatives;

			return yield* Do.let("quoted", () => quoting(lvl, scrutinee, unfold, levels)).in(({ quoted }) => result(EB.Constructors.Match(quoted, alternatives)));
		})
		.with(NF.Patterns.StuckProj, ({ value: { label, base } }) =>
			Do.let("quoted", () => quoting(lvl, base, unfold, levels)).in(({ quoted }) => result(EB.Constructors.Proj(label, quoted))),
		)
		.with(NF.Patterns.StuckInj, ({ value: { label, base, injected } }) =>
			Do.let("value", () => quoting(lvl, injected, unfold, levels))
				.let("target", () => quoting(lvl, base, unfold, levels))
				.in(({ value, target }) => result(EB.Constructors.Inj(label, value, target))),
		)
		.with({ type: "Neutral" }, function* ({ value }) {
			return yield* quoting(lvl, value, unfold, levels);
		})
		.with(NF.Patterns.Reset, ({ value, handling }) =>
			Do.let("body", () => quoting(lvl, value, unfold, levels))
				.let("identity", () => quoting(lvl, handling.identity, unfold, levels))
				.let("handler", () => quoting(lvl, handling.handler, unfold, levels))
				.in(({ body, identity, handler }) => result(EB.Constructors.Reset(body, { identity, handler }))),
		)
		.with(NF.Patterns.Produced, ({ variable, annotation, body, producer }) =>
			Do.let("producer", () => quoting(lvl + 1, producer, unfold, levels))
				.let("body", () => M.reader.local(_ => body.ctx, quoting(lvl + 1, body.value, unfold, new Map([...levels, [body.level, lvl]]))))
				.in(({ producer, body }) => result(EB.Constructors.Block([EB.Constructors.Stmt.Let(variable, producer, annotation)], body))),
		)
		.with({ type: "Bubble", pending: P.nonNullable }, ({ meta, ann, values, operation, pending: captured }) => {
			const producer = NF.Constructors.Bubble(meta, ann, values, operation);
			if (captured.frames.length === 0) {
				return quoting(lvl, producer, unfold, levels);
			}
			/* A symbolic operation identity can later resolve to this delimiter, so its producer stays inside the reset. */
			const index = captured.frames.findLastIndex(frame => frame.type === "Delimiter" && frame.handling);
			const inner = { ...captured, frames: captured.frames.slice(index + 1) };
			return Do.let("continued", function* () {
				yield* Stack.enter(yield* scope());
				return yield* Stack.resume<NF.Value, Scope, EB.Term, Handling>(inner, NF.Constructors.Rigid(lvl));
			}).in(({ continued }) =>
				Do.let("value", () => {
					const value = NF.Constructors.Exists("$suspended", ann, { ctx: captured.scope.env, level: lvl, value: continued }, producer);
					return match(captured.frames[index])
						.with({ type: "Delimiter", handling: P.nonNullable }, function* ({ handling }) {
							const reset = NF.Constructors.Neutral("Blocked", NF.Constructors.Reset(value, handling));
							if (index === 0) {
								return yield* result(reset);
							}
							yield* Stack.enter(yield* scope());
							return yield* Stack.resume<NF.Value, Scope, EB.Term, Handling>({ ...captured, frames: captured.frames.slice(0, index) }, reset);
						})
						.otherwise(() => result(value));
				}).in(({ value }) => quoting(lvl, value, unfold, levels)),
			);
		})
		.with(NF.Patterns.Bubble, ({ meta, ann, values, operation: { identity, payload } }) =>
			Do.let("identity", () => quoting(lvl, identity, unfold, levels))
				.let("payload", () => quoting(lvl, payload, unfold, levels))
				.let("annotation", () => quoting(lvl, ann, unfold, levels))
				.in(({ identity, payload, annotation }) => result(EB.Constructors.Bubble(meta, ann, values, EB.Constructors.Suspend(identity, payload, annotation)))),
		)
		.with({ type: "App" }, ({ func, arg, icit }) =>
			Do.let("f", () => quoting(lvl, func, unfold, levels))
				.let("a", () => quoting(lvl, arg, unfold, levels))
				.in(({ f, a }) => result(EB.Constructors.App(icit, f, a))),
		)
		.with({ type: "Abs", binder: { type: "Lambda" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;
			const level = levels.size ? closure.ctx.env.length : lvl;
			const nested = (levels.get(level) ?? level) === lvl ? levels : new Map([...levels, [level, lvl]]);

			return yield* Do.let("applied", function* () {
				yield* Stack.enter(yield* scope());
				return yield* schedule.apply(binder, closure, NF.Constructors.Rigid(level));
			}).in(({ applied }) =>
				Do.let("body", () => M.reader.local(_ => closure.ctx, quoting(lvl + 1, applied, unfold, nested)))
					.let("ann", () => quoting(lvl, annotation, unfold, levels))
					.in(({ body, ann }) => result(EB.Constructors.Lambda(variable, icit, body, ann))),
			);
		})
		.with({ type: "Abs", binder: { type: "Pi" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;
			const level = levels.size ? closure.ctx.env.length : lvl;
			const nested = (levels.get(level) ?? level) === lvl ? levels : new Map([...levels, [level, lvl]]);

			return yield* Do.let("applied", function* () {
				yield* Stack.enter(yield* scope());
				return yield* schedule.apply(binder, closure, NF.Constructors.Rigid(level));
			}).in(({ applied }) =>
				Do.let("body", () => M.reader.local(_ => closure.ctx, quoting(lvl + 1, applied, unfold, nested)))
					.let("ann", () => quoting(lvl, annotation, unfold, levels))
					.in(({ body, ann }) => result(EB.Constructors.Pi(variable, icit, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, function* ({ binder, closure }) {
			const { variable, source, annotation } = binder;
			const level = levels.size ? closure.ctx.env.length : lvl;
			const nested = (levels.get(level) ?? level) === lvl ? levels : new Map([...levels, [level, lvl]]);

			return yield* Do.let("applied", function* () {
				yield* Stack.enter(yield* scope());
				return yield* schedule.apply(binder, closure, NF.Constructors.Rigid(level));
			}).in(({ applied }) =>
				Do.let("body", () => M.reader.local(_ => closure.ctx, quoting(lvl + 1, applied, unfold, nested)))
					.let("ann", () => quoting(lvl, annotation, unfold, levels))
					.in(({ body, ann }) => result(EB.Constructors.Mu(variable, source, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "Sigma" } }, function* ({ binder, closure }) {
			const { variable, annotation } = binder;

			// Apply with symbolic label neutrals so matches get stuck instead of crashing.
			// Analogous to Pi quoting applying with Rigid(lvl).
			return yield* Do.let("applied", function* () {
				yield* Stack.enter(yield* scope());
				return yield* schedule.apply(binder, closure, NF.Constructors.Row(symbolicRow(annotation)));
			}).in(({ applied }) =>
				Do.let("body", () => M.reader.local(_ => closure.ctx, quoting(lvl, applied, unfold, levels)))
					.let("ann", () => quoting(lvl, annotation, unfold, levels))
					.in(({ body, ann }) => result(EB.Constructors.Sigma(variable, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "SigmaV2" } }, function* ({ binder, closure }) {
			const { variable, annotation } = binder;
			const level = levels.size ? closure.ctx.env.length : lvl;
			const nested = (levels.get(level) ?? level) === lvl ? levels : new Map([...levels, [level, lvl]]);

			return yield* Do.let("applied", function* () {
				yield* Stack.enter(yield* scope());
				return yield* schedule.apply(binder, closure, NF.Constructors.Rigid(level));
			}).in(({ applied }) =>
				Do.let("body", () => M.reader.local(_ => closure.ctx, quoting(lvl + 1, applied, unfold, nested)))
					.let("ann", () => quoting(lvl, annotation, unfold, levels))
					.in(({ body, ann }) => result(EB.Constructors.SigmaV2(variable, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "Nu" } }, function* ({ binder, closure }) {
			/* The frame is opened without field terms, so a `$label` finds nothing to evaluate and quotes back as a reference. */
			const held = EB.open({ ...binder, scoped: R.Constructors.Empty() }, closure.ctx);
			const back = (term: EB.Term) =>
				M.reader.local(
					_ => held,
					Do.let("value", () => NbE.eval(term)).in(({ value }) => quoting(lvl, value, unfold, levels)),
				);

			return yield* Do.let("body", () => back(closure.term))
				.let("scoped", () => back(EB.Constructors.Row(binder.scoped)))
				.let("annotation", () => M.reader.local(_ => held, quoting(lvl, binder.annotation, unfold, levels)))
				.in(function* ({ body, scoped, annotation }) {
					assert(scoped.type === "Row", "A row reads back as a row");
					return yield* result(EB.Constructors.Nu({ mode: binder.mode, labels: binder.labels, scoped: scoped.row, annotation }, body));
				});
		})
		.with({ type: "Row" }, ({ row }) => Do.let("quoted", () => quoteRow(lvl, row, unfold, levels)).in(({ quoted }) => result(EB.Constructors.Row(quoted))))
		.with({ type: "External" }, function* ({ name, args }) {
			return yield* group(
				args.map(arg => () => quoting(lvl, arg, unfold, levels)),
				function* (quoted) {
					return yield* result(quoted.reduce<EB.Term>((acc, arg) => EB.Constructors.App("Explicit", acc, arg), EB.Constructors.Var({ type: "Foreign", name })));
				},
			);
		})
		.with({ type: "Modal" }, ({ value, modalities }) =>
			Do.let("quoted", () => quoting(lvl, value, unfold, levels))
				.let("liquid", () => quoting(lvl, modalities.liquid, unfold, levels))
				.in(({ quoted, liquid }) => result(EB.Constructors.Modal(quoted, { quantity: modalities.quantity, liquid }))),
		)
		.otherwise(function* (nf) {
			throw new Error("Quote: Not implemented yet: " + (yield* display(nf)));
		});
}

const quoteRow = function* (lvl: number, row: NF.Row, unfold: NF.Unfolding, levels: ReadonlyMap<number, number>): Evaluation<Machine<EB.Row>> {
	const { local } = yield* M.reader.ask();
	const tail = match(row.tail)
		.with(P.nullish, () => undefined)
		.with({ type: "Bound" }, (b): EB.Variable => ({ type: "Bound", index: lvl - (levels.get(b.lvl) ?? b.lvl) - 1 }))
		.with(
			{ type: "DepLabel" },
			(b): EB.Variable => ({ type: "DepLabel", name: b.name, index: lvl - (levels.get(b.lvl) ?? b.lvl) - 1, annotation: b.annotation }),
		)
		.with({ type: "NuLabel" }, (b): EB.Variable => ({ type: "NuLabel", name: b.name, index: local.length - b.lvl - 1, annotation: b.annotation }))
		.otherwise(b => b);

	return yield* group(
		row.entries.map(
			({ value }) =>
				() =>
					quoting(lvl, value, unfold, levels),
		),
		(quoted: EB.Term[]) =>
			result(
				R.Constructors.Row<EB.Term, EB.Variable>(
					row.entries.map(({ label }, i) => ({ label, value: quoted[i] })),
					tail,
				),
			),
	);
};

export function* closeVal(value: NF.Value): Evaluation<Machine<NF.Closure>> {
	const ctx = yield* M.reader.ask();

	return yield* Do.let("term", () => quote(ctx.env.length + 1, value)).in(({ term }) => result({ type: "Closure", ctx, term }));
}
