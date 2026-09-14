import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as NF from "./syntax/term";
import { display } from "./syntax/pretty";
import { Do, group, result, type Evaluation, type Machine } from "./effects";
import { schedule } from "./evaluation.v2";
import { match, P } from "ts-pattern";
import assert from "node:assert";

const symbolicRow = (annotation: NF.Value): NF.Row => {
	const go = (r: NF.Row): NF.Row =>
		match(r)
			.with({ type: "empty" }, (): NF.Row => ({ type: "empty" }))
			.with(
				{ type: "extension" },
				({ label, row }): NF.Row =>
					NF.Constructors.Extension(label, NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: label })), go(row)),
			)
			.with({ type: "variable" }, (v): NF.Row => v)
			.exhaustive();

	assert(annotation.type === "Row", "Sigma annotation should be a Row");
	return go(annotation.row);
};

/**
 * Quotes a value at the given level, under the ambient context.
 * We explicitly pass the level to avoid extending the context when quoting under binders.
 * Closure bodies quote under their own stored context — closure consumption, via reader.local.
 */
export function* quote(lvl: number, val: NF.Value): Evaluation<Machine<EB.Term>> {
	return yield* match(val)
		.with({ type: "Lit" }, function* ({ value }) {
			return yield* result(EB.Constructors.Lit(value));
		})
		.with({ type: "Var" }, function* ({ variable }) {
			return yield* match(variable)
				.with({ type: "Bound" }, function* (v) {
					return yield* result(EB.Constructors.Var({ type: "Bound", index: lvl - v.lvl - 1 }));
				})
				.with({ type: P.union("DepLabel", "NuLabel") }, function* (v) {
					return yield* result(EB.Constructors.Var({ type: v.type, name: v.name, index: lvl - v.lvl - 1 }));
				})
				.with({ type: "Meta" }, function* (v) {
					const solved = Metas.solution(yield* Metas.registry.get(), v.val);

					return yield* solved ? quote(lvl, solved) : result(EB.Constructors.Var(v));
				})
				.otherwise(function* (v) {
					return yield* result(EB.Constructors.Var(v));
				});
		})

		.with(NF.Patterns.StuckMatch, function* ({ value: { closure, scrutinee } }) {
			assert(closure.type === "Closure", "Blocked match should retain a term closure");
			assert(closure.term.type === "Match", "Blocked match closure should retain a match term");

			const alternatives = closure.term.alternatives;

			return yield* Do.let("quoted", quote(lvl, scrutinee)).in(({ quoted }) => result(EB.Constructors.Match(quoted, alternatives)));
		})
		.with(NF.Patterns.StuckProj, ({ value: { label, base } }) =>
			Do.let("quoted", quote(lvl, base)).in(({ quoted }) => result(EB.Constructors.Proj(label, quoted))),
		)
		.with(NF.Patterns.StuckInj, ({ value: { label, base, injected } }) =>
			Do.let("value", quote(lvl, injected))
				.let("target", quote(lvl, base))
				.in(({ value, target }) => result(EB.Constructors.Inj(label, value, target))),
		)
		.with({ type: "Neutral" }, function* ({ value }) {
			return yield* quote(lvl, value);
		})
		.with({ type: "App" }, ({ func, arg, icit }) =>
			Do.let("f", quote(lvl, func))
				.let("a", quote(lvl, arg))
				.in(({ f, a }) => result(EB.Constructors.App(icit, f, a))),
		)
		.with({ type: "Abs", binder: { type: "Lambda" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;

			return yield* Do.let("applied", schedule.apply(binder, closure, NF.Constructors.Rigid(lvl))).in(({ applied }) =>
				Do.let(
					"body",
					M.reader.local(_ => closure.ctx, quote(lvl + 1, applied)),
				)
					.let("ann", quote(lvl, annotation))
					.in(({ body, ann }) => result(EB.Constructors.Lambda(variable, icit, body, ann))),
			);
		})
		.with({ type: "Abs", binder: { type: "Pi" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;

			return yield* Do.let("applied", schedule.apply(binder, closure, NF.Constructors.Rigid(lvl))).in(({ applied }) =>
				Do.let(
					"body",
					M.reader.local(_ => closure.ctx, quote(lvl + 1, applied)),
				)
					.let("ann", quote(lvl, annotation))
					.in(({ body, ann }) => result(EB.Constructors.Pi(variable, icit, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, function* ({ binder, closure }) {
			const { variable, source, annotation } = binder;

			return yield* Do.let("applied", schedule.apply(binder, closure, NF.Constructors.Rigid(lvl))).in(({ applied }) =>
				Do.let(
					"body",
					M.reader.local(_ => closure.ctx, quote(lvl + 1, applied)),
				)
					.let("ann", quote(lvl, annotation))
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
					M.reader.local(_ => closure.ctx, quote(lvl, applied)),
				)
					.let("ann", quote(lvl, annotation))
					.in(({ body, ann }) => result(EB.Constructors.Sigma(variable, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "SigmaV2" } }, function* ({ binder, closure }) {
			const { variable, annotation } = binder;

			return yield* Do.let("applied", schedule.apply(binder, closure, NF.Constructors.Rigid(lvl))).in(({ applied }) =>
				Do.let(
					"body",
					M.reader.local(_ => closure.ctx, quote(lvl + 1, applied)),
				)
					.let("ann", quote(lvl + 1, annotation))
					.in(({ body, ann }) => result(EB.Constructors.SigmaV2(variable, ann, body))),
			);
		})
		.with({ type: "Abs", binder: { type: "Nu" } }, function* ({ binder, closure }) {
			const { variable, annotation } = binder;

			return yield* Do.let("applied", schedule.apply(binder, closure, NF.Constructors.Rigid(lvl))).in(({ applied }) =>
				Do.let(
					"body",
					M.reader.local(_ => closure.ctx, quote(lvl + 1, applied)),
				)
					.let("ann", quote(lvl, annotation))
					.in(({ body, ann }) => result(EB.Constructors.Nu(variable, ann, body))),
			);
		})
		.with({ type: "Row" }, ({ row }) => Do.let("quoted", quoteRow(lvl, row)).in(({ quoted }) => result(EB.Constructors.Row(quoted))))
		.with({ type: "External" }, function* ({ name, args }) {
			return yield* group(
				args.map(arg => quote(lvl, arg)),
				function* (quoted) {
					return yield* result(quoted.reduce<EB.Term>((acc, arg) => EB.Constructors.App("Explicit", acc, arg), EB.Constructors.Var({ type: "Foreign", name })));
				},
			);
		})
		.with({ type: "Modal" }, ({ value, modalities }) =>
			Do.let("quoted", quote(lvl, value))
				.let("liquid", quote(lvl, modalities.liquid))
				.in(({ quoted, liquid }) => result(EB.Constructors.Modal(quoted, { quantity: modalities.quantity, liquid }))),
		)
		.otherwise(function* (nf) {
			throw new Error("Quote: Not implemented yet: " + (yield* display(nf)));
		});
}

const quoteRow = function* (lvl: number, row: NF.Row): Evaluation<Machine<EB.Row>> {
	return yield* match(row)
		.with({ type: "empty" }, function* () {
			return yield* result<EB.Row>({ type: "empty" });
		})
		.with({ type: "extension" }, ({ label, value, row: rest }) =>
			Do.let("quoted", quote(lvl, value))
				.let("tail", quoteRow(lvl, rest))
				.in(({ quoted, tail }) => result(EB.Constructors.Extension(label, quoted, tail))),
		)
		.with({ type: "variable" }, function* ({ variable }) {
			const v = match(variable)
				.with({ type: "Bound" }, (b): EB.Variable => ({ type: "Bound", index: lvl - b.lvl - 1 }))
				.with({ type: P.union("DepLabel", "NuLabel") }, (b): EB.Variable => ({ type: b.type, name: b.name, index: lvl - b.lvl - 1 }))
				.otherwise(b => b);

			return yield* result<EB.Row>({ type: "variable", variable: v });
		})
		.exhaustive();
};

export function* closeVal(value: NF.Value): Evaluation<Machine<NF.Closure>> {
	const ctx = yield* M.reader.ask();

	return yield* Do.let("term", quote(ctx.env.length + 1, value)).in(({ term }) => result({ type: "Closure", ctx, term }));
}
