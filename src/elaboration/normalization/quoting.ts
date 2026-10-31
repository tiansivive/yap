import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as NF from "./syntax/term";
import * as R from "@yap/shared/rows";
import { display } from "./syntax/pretty";
import { Do, group, result, type Evaluation, type Machine } from "./effects";
import { schedule } from "./evaluation.v2";
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

			const alternatives = closure.term.alternatives;

			return yield* Do.let("quoted", quote(lvl, scrutinee, unfold)).in(({ quoted }) => result(EB.Constructors.Match(quoted, alternatives)));
		})
		.with(NF.Patterns.StuckProj, ({ value: { label, base } }) =>
			Do.let("quoted", quote(lvl, base, unfold)).in(({ quoted }) => result(EB.Constructors.Proj(label, quoted))),
		)
		.with(NF.Patterns.StuckInj, ({ value: { label, base, injected } }) =>
			Do.let("value", quote(lvl, injected, unfold))
				.let("target", quote(lvl, base, unfold))
				.in(({ value, target }) => result(EB.Constructors.Inj(label, value, target))),
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

			return yield* Do.let("applied", schedule.apply(binder, closure, NF.Constructors.Rigid(lvl))).in(({ applied }) =>
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

			return yield* Do.let("applied", schedule.apply(binder, closure, NF.Constructors.Rigid(lvl))).in(({ applied }) =>
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

			return yield* Do.let("applied", schedule.apply(binder, closure, NF.Constructors.Rigid(lvl))).in(({ applied }) =>
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
			return yield* Do.let("applied", schedule.apply(binder, closure, NF.Constructors.Row(symbolicRow(annotation)))).in(({ applied }) =>
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

			return yield* Do.let("applied", schedule.apply(binder, closure, NF.Constructors.Rigid(lvl))).in(({ applied }) =>
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
					Do.let("value", schedule.eval(term)).in(({ value }) => quote(lvl, value, unfold)),
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
