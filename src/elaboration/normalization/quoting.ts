import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as NF from "./syntax/term";
import { close, value as captured, annotation as scopedAnnotation } from "./closing";
import * as R from "@yap/shared/rows";
import { display } from "./syntax/pretty";
import { Do, group, result, type Evaluation, type Machine } from "./effects";
import { schedule, drive } from "./evaluation.v2";
import * as Eff from "@yap/utils/effects";
import { handlers } from "./machine/handlers";
import { options } from "@yap/shared/config/options";
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
export function* quote(lvl: number, val: NF.Value, unfold: NF.Unfolding = "none"): Evaluation<Machine<EB.Term>> {
	return yield* match(val)
		.with(NF.Patterns.Deferred, ({ source }) => close(lvl, source))
		.with(NF.Patterns.Computation, ({ request, contexts, ctx }) => computation(lvl, request, contexts, unfold, ctx))
		.with(NF.Patterns.Suspend, ({ identity, signature, payload, annotation }) =>
			Do.let("identity", identityTerm(lvl, identity, signature, unfold))
				.let("payload", quote(lvl, payload, unfold))
				.let("annotation", quote(lvl, annotation, unfold))
				.in(({ identity, payload, annotation }) => result(EB.Constructors.Suspend(identity, payload, annotation))),
		)
		.with(NF.Patterns.Glued, ({ folded, unfolded }) => quote(lvl, unfold === "definitions" ? unfolded : folded, unfold))
		.with({ type: "Lit" }, function* ({ value }) {
			return yield* result(EB.Constructors.Lit(value));
		})
		.with({ type: "Var" }, function* ({ variable }) {
			return yield* match(variable)
				.with({ type: "Bound" }, function* (v) {
					return yield* result(EB.Constructors.Var({ type: "Bound", index: lvl - v.lvl - 1 }));
				})
				.with({ type: "DepLabel" }, function* (v) {
					return yield* result(EB.Constructors.Var({ type: "DepLabel", name: v.name, index: lvl - v.lvl - 1, annotation: v.annotation }));
				})
				.with({ type: "NuLabel" }, function* (v) {
					const { local } = yield* M.reader.ask();
					return yield* result(EB.Constructors.Var({ type: "NuLabel", name: v.name, index: local.length - v.lvl - 1, annotation: v.annotation }));
				})
				.with({ type: "Meta" }, function* (v) {
					const solved = Metas.solution(yield* Metas.registry.get(), v.val);

					return yield* solved ? quote(lvl, solved, unfold) : result(EB.Constructors.Var(v));
				})
				.otherwise(function* (v) {
					return yield* result(EB.Constructors.Var(v));
				});
		})

		.with(NF.Patterns.StuckMatch, function* ({ value: { closure, scrutinee } }) {
			assert(closure.type === "Closure", "Blocked match should retain a term closure");
			assert(closure.term.type === "Match", "Blocked match closure should retain a match term");

			return yield* Do.let("quoted", quote(lvl, scrutinee, unfold))
				.let("saved", close(lvl, closure))
				.in(({ quoted, saved }) => {
					assert(saved.type === "Match", "A saved match keeps its alternatives");
					return result(EB.Constructors.Match(quoted, saved.alternatives));
				});
		})
		.with(NF.Patterns.StuckProj, ({ value: { label, base } }) =>
			Do.let("quoted", quote(lvl, base, unfold)).in(({ quoted }) => result(EB.Constructors.Proj(label, quoted))),
		)
		.with(NF.Patterns.StuckInj, ({ value: { label, base, injected } }) =>
			Do.let("value", quote(lvl, injected, unfold))
				.let("target", quote(lvl, base, unfold))
				.in(({ value, target }) => result(EB.Constructors.Inj(label, value, target))),
		)
		.with(NF.Patterns.Match, ({ closure, scrutinee }) =>
			Do.let("scrutinee", quote(lvl, scrutinee, unfold))
				.let("saved", close(lvl, closure))
				.in(({ scrutinee, saved }) => {
					assert(saved.type === "Match", "A saved match keeps its alternatives");
					return result(EB.Constructors.Match(scrutinee, saved.alternatives));
				}),
		)
		.with({ type: "Neutral" }, function* ({ value }) {
			return yield* quote(lvl, value, unfold);
		})
		.with({ type: "App" }, ({ func, arg, icit }) =>
			Do.let("f", quote(lvl, func, unfold))
				.let("a", quote(lvl, arg, unfold))
				.in(({ f, a }) => result(EB.Constructors.App(icit, f, a))),
		)
		.with({ type: "Abs", binder: { type: "Lambda" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;

			return yield* Do.let("applied", inspect(schedule.apply(binder, closure, NF.Constructors.Rigid(lvl)))).in(({ applied }) =>
				Do.let(
					"body",
					M.reader.local(_ => closure.ctx, quote(lvl + 1, applied, unfold)),
				)
					.let("ann", quote(lvl, annotation, unfold))
					.in(({ body, ann }) => result(EB.Constructors.Lambda(variable, icit, body, ann))),
			);
		})
		.with({ type: "Abs", binder: { type: "Pi" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;

			return yield* Do.let("applied", inspect(schedule.apply(binder, closure, NF.Constructors.Rigid(lvl)))).in(({ applied }) =>
				Do.let(
					"body",
					M.reader.local(_ => closure.ctx, quote(lvl + 1, applied, unfold)),
				)
					.let("ann", quote(lvl, annotation, unfold))
					.in(({ body, ann }) => result(EB.Constructors.Pi(variable, icit, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, function* ({ binder, closure }) {
			const { variable, source, annotation } = binder;

			return yield* Do.let("applied", inspect(schedule.apply(binder, closure, NF.Constructors.Rigid(lvl)))).in(({ applied }) =>
				Do.let(
					"body",
					M.reader.local(_ => closure.ctx, quote(lvl + 1, applied, unfold)),
				)
					.let("ann", quote(lvl, annotation, unfold))
					.in(({ body, ann }) => result(EB.Constructors.Mu(variable, source, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "Sigma" } }, function* ({ binder, closure }) {
			const { variable, annotation } = binder;

			// Apply with symbolic label neutrals so matches get stuck instead of crashing.
			// Analogous to Pi quoting applying with Rigid(lvl).
			return yield* Do.let("applied", inspect(schedule.apply(binder, closure, NF.Constructors.Row(symbolicRow(annotation))))).in(({ applied }) =>
				Do.let(
					"body",
					M.reader.local(_ => closure.ctx, quote(lvl, applied, unfold)),
				)
					.let("ann", quote(lvl, annotation, unfold))
					.in(({ body, ann }) => result(EB.Constructors.Sigma(variable, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "SigmaV2" } }, function* ({ binder, closure }) {
			const { variable, annotation } = binder;

			return yield* Do.let("applied", inspect(schedule.apply(binder, closure, NF.Constructors.Rigid(lvl)))).in(({ applied }) =>
				Do.let(
					"body",
					M.reader.local(_ => closure.ctx, quote(lvl + 1, applied, unfold)),
				)
					.let("ann", quote(lvl, annotation, unfold))
					.in(({ body, ann }) => result(EB.Constructors.SigmaV2(variable, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "Nu" } }, function* ({ binder, closure }) {
			/* The frame is opened without field terms, so a `$label` finds nothing to evaluate and quotes back as a reference. */
			const held = EB.open({ ...binder, scoped: R.Constructors.Empty() }, closure.ctx);
			const back = (term: EB.Term) =>
				M.reader.local(
					_ => held,
					Do.let("value", inspect(schedule.eval(term))).in(({ value }) => quote(lvl, value, unfold)),
				);

			return yield* Do.let("body", back(closure.term))
				.let("scoped", back(EB.Constructors.Row(binder.scoped)))
				.let(
					"annotation",
					M.reader.local(_ => held, quote(lvl, binder.annotation, unfold)),
				)
				.in(function* ({ body, scoped, annotation }) {
					assert(scoped.type === "Row", "A row reads back as a row");
					return yield* result(EB.Constructors.Nu({ mode: binder.mode, labels: binder.labels, scoped: scoped.row, annotation }, body));
				});
		})
		.with({ type: "Row" }, ({ row }) => Do.let("quoted", quoteRow(lvl, row, unfold)).in(({ quoted }) => result(EB.Constructors.Row(quoted))))
		.with({ type: "External" }, function* ({ name, args }) {
			return yield* group(
				args.map(arg => quote(lvl, arg, unfold)),
				function* (quoted) {
					return yield* result(quoted.reduce<EB.Term>((acc, arg) => EB.Constructors.App("Explicit", acc, arg), EB.Constructors.Var({ type: "Foreign", name })));
				},
			);
		})
		.with({ type: "Modal" }, ({ value, modalities }) =>
			Do.let("quoted", quote(lvl, value, unfold))
				.let("liquid", quote(lvl, modalities.liquid, unfold))
				.in(({ quoted, liquid }) => result(EB.Constructors.Modal(quoted, { quantity: modalities.quantity, liquid }))),
		)
		.otherwise(function* (nf) {
			throw new Error("Quote: Not implemented yet: " + (yield* display(nf)));
		});
}

function* inspect(work: Evaluation<Machine<NF.Value>>): Evaluation<Machine<NF.Value>> {
	const [value] = yield* Eff.with([handlers<Scope, EB.Term, Handling>(options.maxSteps)], () =>
		drive(work, steps => `Readback observation exceeded maximum steps (${steps}).`),
	);
	return yield* result(value);
}

function* identityTerm(lvl: number, value: NF.Value, signature: NF.Value | undefined, unfold: NF.Unfolding, owner?: EB.Context): Evaluation<Machine<EB.Term>> {
	return yield* Do.let("value", owner ? captured(lvl, { ctx: owner, value }) : quote(lvl, value, unfold)).in(({ value }) =>
		signature
			? Do.let("annotation", owner ? captured(lvl, { ctx: owner, value: signature }) : quote(lvl, signature, unfold)).in(({ annotation }) =>
					result(EB.Constructors.Ann(value, annotation)),
				)
			: result(value),
	);
}

function* computation(lvl: number, request: NF.Value, contexts: readonly NF.Context[], unfold: NF.Unfolding, ctx: EB.Context): Evaluation<Machine<EB.Term>> {
	const context = contexts.at(-1);

	if (!context) {
		return yield* captured(lvl, { ctx, value: request });
	}
	const inner = (depth = lvl) => computation(depth, request, contexts.slice(0, -1), unfold, ctx);
	return yield* match(context)
		.with({ type: "Function" }, ({ argument, icit }) =>
			Do.let("func", inner())
				.let("arg", close(lvl, argument))
				.in(({ func, arg }) => result(EB.Constructors.App(icit, func, arg))),
		)
		.with({ type: "Argument" }, ({ func, icit }) =>
			Do.let("func", captured(lvl, { ctx: context.ctx, value: func }))
				.let("arg", inner())
				.in(({ func, arg }) => result(EB.Constructors.App(icit, func, arg))),
		)
		.with({ type: "Applied" }, ({ arg, icit }) =>
			Do.let("func", inner())
				.let("arg", captured(lvl, { ctx: context.ctx, value: arg }))
				.in(({ func, arg }) => result(EB.Constructors.App(icit, func, arg))),
		)
		.with({ type: "SuspensionIdentity" }, ({ payload, annotation }) =>
			Do.let("identity", inner())
				.let("payload", close(lvl, payload))
				.let("annotation", captured(lvl, { ctx: context.ctx, value: annotation }))
				.in(({ identity, payload, annotation }) => result(EB.Constructors.Suspend(identity, payload, annotation))),
		)
		.with({ type: "SuspensionPayload" }, ({ identity, signature, annotation }) =>
			Do.let("identity", identityTerm(lvl, identity, signature, unfold, context.ctx))
				.let("payload", inner())
				.let("annotation", captured(lvl, { ctx: context.ctx, value: annotation }))
				.in(({ identity, payload, annotation }) => result(EB.Constructors.Suspend(identity, payload, annotation))),
		)
		.with({ type: "HandlingIdentity" }, ({ handler, body }) =>
			Do.let("identity", inner())
				.let("handler", close(lvl, handler))
				.let("body", close(lvl, body))
				.in(({ identity, handler, body }) => result(EB.Constructors.Reset(body, { identity, handler }))),
		)
		.with({ type: "HandlingHandler" }, ({ identity, signature, body }) =>
			Do.let("identity", identityTerm(lvl, identity, signature, unfold, context.ctx))
				.let("handler", inner())
				.let("body", close(lvl, body))
				.in(({ identity, handler, body }) => result(EB.Constructors.Reset(body, { identity, handler }))),
		)
		.with({ type: "RowTail" }, ({ preceding }) =>
			Do.let(
				"preceding",
				group(
					preceding.map(({ label, value }) => Do.let("value", captured(lvl, { ctx: context.ctx, value })).in(({ value }) => result({ label, value }))),
					result,
				),
			)
				.let("tail", inner())
				.in(({ preceding, tail }) => {
					assert(tail.type === "Row", "A residual row tail retains row syntax");
					return result(EB.Constructors.Row(R.append(R.Constructors.Row(preceding), tail.row)));
				}),
		)
		.with({ type: "ModalLiquid" }, ({ value, quantity }) =>
			Do.let("value", captured(lvl, { ctx: context.ctx, value }))
				.let("liquid", inner())
				.in(({ value, liquid }) => result(EB.Constructors.Modal(value, { quantity, liquid }))),
		)
		.with({ type: "Sequence" }, ({ following }) =>
			Do.let("first", inner())
				.let("rest", close(lvl, following))
				.in(({ first, rest }) => result(EB.Constructors.Block([EB.Constructors.Stmt.Expr(first)], rest))),
		)
		.with({ type: "Let" }, ({ variable, annotation, following }) => {
			const [entry, ...env] = following.ctx.env;
			const source = { ...following, ctx: { ...following.ctx, env: [{ ...entry, nf: NF.Constructors.Rigid(lvl) }, ...env] } };
			return Do.let("annotation", scopedAnnotation(lvl, { ctx: context.ctx, value: annotation }))
				.let("value", inner(lvl + 1))
				.let("body", close(lvl + 1, source))
				.in(({ annotation, value, body }) => result(EB.Constructors.Block([EB.Constructors.Stmt.Let(variable, value, annotation)], body)));
		})
		.with({ type: "Reset" }, ({ identity, signature, handler }) =>
			Do.let("identity", identityTerm(lvl, identity, signature, unfold, context.ctx))
				.let("handler", captured(lvl, { ctx: context.ctx, value: handler }))
				.let("body", inner())
				.in(({ identity, handler, body }) => result(EB.Constructors.Reset(body, { identity, handler }))),
		)
		.with({ type: "Project" }, ({ label }) => Do.let("term", inner()).in(({ term }) => result(EB.Constructors.Proj(label, term))))
		.with({ type: "InjectionBase" }, ({ label, injected }) =>
			Do.let("base", inner())
				.let("injected", close(lvl, injected))
				.in(({ base, injected }) => result(EB.Constructors.Inj(label, injected, base))),
		)
		.with({ type: "InjectionValue" }, ({ label, base }) =>
			Do.let("base", captured(lvl, { ctx: context.ctx, value: base }))
				.let("injected", inner())
				.in(({ base, injected }) => result(EB.Constructors.Inj(label, injected, base))),
		)
		.with({ type: "Match" }, ({ alternatives }) =>
			Do.let("scrutinee", inner())
				.let("match", close(lvl, alternatives))
				.in(({ scrutinee, match }) => {
					assert(match.type === "Match", "A saved match keeps its alternatives");
					return result(EB.Constructors.Match(scrutinee, match.alternatives));
				}),
		)
		.with({ type: "Row" }, ({ preceding, label, following }) =>
			Do.let(
				"prefix",
				group(
					preceding.map(({ value }) => captured(lvl, { ctx: context.ctx, value })),
					result,
				),
			)
				.let("value", inner())
				.let("rest", close(lvl, following))
				.in(({ prefix, value, rest }) => {
					assert(rest.type === "Row", "Saved row fields retain their row");
					return result(
						EB.Constructors.Row(
							R.Constructors.Row(
								[...preceding.map(({ label }, index) => ({ label, value: prefix[index] })), { label, value }, ...rest.row.entries],
								rest.row.tail,
							),
						),
					);
				}),
		)
		.with({ type: "Modal" }, ({ quantity, liquid }) =>
			Do.let("term", inner())
				.let("liquid", close(lvl, liquid))
				.in(({ term, liquid }) => result(EB.Constructors.Modal(term, { quantity, liquid }))),
		)
		.exhaustive();
}

const quoteRow = function* (lvl: number, row: NF.Row, unfold: NF.Unfolding): Evaluation<Machine<EB.Row>> {
	const { local } = yield* M.reader.ask();
	const tail = match(row.tail)
		.with(P.nullish, () => undefined)
		.with({ type: "Bound" }, (b): EB.Variable => ({ type: "Bound", index: lvl - b.lvl - 1 }))
		.with({ type: "DepLabel" }, (b): EB.Variable => ({ type: "DepLabel", name: b.name, index: lvl - b.lvl - 1, annotation: b.annotation }))
		.with({ type: "NuLabel" }, (b): EB.Variable => ({ type: "NuLabel", name: b.name, index: local.length - b.lvl - 1, annotation: b.annotation }))
		.otherwise(b => b);

	return yield* group(
		row.entries.map(({ value }) => quote(lvl, value, unfold)),
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

	return yield* Do.let("term", quote(ctx.env.length + 1, value)).in(({ term }) => result({ type: "Closure", ctx, term }));
}
