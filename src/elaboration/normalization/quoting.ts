import * as EB from "@yap/elaboration";
import * as Eff from "@yap/utils/effects";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as NF from "./syntax/term";
import { display } from "./syntax/pretty";
import { Evaluation } from "./callstack";
import { apply } from "./evaluation.v2";
import { match } from "ts-pattern";
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
export function* quote(lvl: number, val: NF.Value): Evaluation<EB.Term> {
	return yield* match(val)
		.with({ type: "Lit" }, function* ({ value }) {
			return EB.Constructors.Lit(value);
		})
		.with({ type: "Var" }, function* ({ variable }) {
			return yield* match(variable)
				.with({ type: "Bound" }, function* (v) {
					return EB.Constructors.Var({ type: "Bound", index: lvl - v.lvl - 1 });
				})
				.with({ type: "Meta" }, function* (v) {
					const solved = Metas.solution(yield* Metas.registry.get(), v.val);

					return solved ? yield* quote(lvl, solved) : EB.Constructors.Var(v);
				})
				.otherwise(function* (v) {
					return EB.Constructors.Var(v);
				});
		})

		.with(NF.Patterns.StuckMatch, function* ({ value: { closure, scrutinee } }) {
			assert(closure.type === "Closure", "Blocked match should retain a term closure");
			assert(closure.term.type === "Match", "Blocked match closure should retain a match term");
			return EB.Constructors.Match(yield* quote(lvl, scrutinee), closure.term.alternatives);
		})
		.with(NF.Patterns.StuckProj, function* ({ value: { label, base } }) {
			return EB.Constructors.Proj(label, yield* quote(lvl, base));
		})
		.with(NF.Patterns.StuckInj, function* ({ value: { label, base, injected } }) {
			return EB.Constructors.Inj(label, yield* quote(lvl, injected), yield* quote(lvl, base));
		})
		.with({ type: "Neutral" }, function* ({ value }) {
			return yield* quote(lvl, value);
		})
		.with({ type: "App" }, function* ({ func, arg, icit }) {
			return EB.Constructors.App(icit, yield* quote(lvl, func), yield* quote(lvl, arg));
		})
		.with({ type: "Abs", binder: { type: "Lambda" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;
			const val = yield* apply(binder, closure, NF.Constructors.Rigid(lvl));
			const body = yield* M.reader.local(_ => closure.ctx, quote(lvl + 1, val));
			const ann = yield* quote(lvl, annotation);
			return EB.Constructors.Lambda(variable, icit, body, ann);
		})
		.with({ type: "Abs", binder: { type: "Pi" } }, function* ({ binder, closure }) {
			const { variable, icit, annotation } = binder;
			const val = yield* apply(binder, closure, NF.Constructors.Rigid(lvl));
			const body = yield* M.reader.local(_ => closure.ctx, quote(lvl + 1, val));
			const ann = yield* quote(lvl, annotation);
			return EB.Constructors.Pi(variable, icit, ann, body);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, function* ({ binder, closure }) {
			const { variable, source, annotation } = binder;
			const val = yield* apply(binder, closure, NF.Constructors.Rigid(lvl));
			const body = yield* M.reader.local(_ => closure.ctx, quote(lvl + 1, val));
			const ann = yield* quote(lvl, annotation);
			return EB.Constructors.Mu(variable, source, ann, body);
		})
		.with({ type: "Abs", binder: { type: "Sigma" } }, function* ({ binder, closure }) {
			const { variable, annotation } = binder;
			// Apply with symbolic label neutrals so matches get stuck instead of crashing.
			// Analogous to Pi quoting applying with Rigid(lvl).
			const symbolic = NF.Constructors.Row(symbolicRow(annotation));
			const val = yield* apply(binder, closure, symbolic);
			const body = yield* M.reader.local(_ => closure.ctx, quote(lvl, val));
			const ann = yield* quote(lvl, annotation);
			return EB.Constructors.Sigma(variable, ann, body);
		})
		.with({ type: "Row" }, function* ({ row }) {
			const _quote = function* (r: NF.Row): Evaluation<EB.Row> {
				return yield* match(r)
					.with({ type: "empty" }, function* (): Evaluation<EB.Row> {
						return { type: "empty" };
					})
					.with({ type: "extension" }, function* ({ label, value, row }) {
						return EB.Constructors.Extension(label, yield* quote(lvl, value), yield* _quote(row));
					})
					.with({ type: "variable" }, function* ({ variable }): Evaluation<EB.Row> {
						const v = match(variable)
							.with({ type: "Bound" }, (b): EB.Variable => ({ type: "Bound", index: lvl - b.lvl - 1 }))
							.otherwise(b => b);
						return { type: "variable", variable: v };
					})
					.exhaustive();
			};

			return EB.Constructors.Row(yield* _quote(row));
		})
		.with({ type: "External" }, function* ({ name, args }) {
			const quoted = yield* Eff.traverse(args, arg => quote(lvl, arg));
			return quoted.reduce<EB.Term>((acc, arg) => EB.Constructors.App("Explicit", acc, arg), EB.Constructors.Var({ type: "Foreign", name }));
		})
		.with({ type: "Modal" }, function* ({ value, modalities }) {
			return EB.Constructors.Modal(yield* quote(lvl, value), {
				quantity: modalities.quantity,
				liquid: yield* quote(lvl, modalities.liquid),
			});
		})
		.otherwise(function* (nf) {
			const ctx = yield* M.reader.ask();
			throw new Error("Quote: Not implemented yet: " + display(nf, ctx));
		});
}

export function* closeVal(value: NF.Value): Evaluation<NF.Closure> {
	const ctx = yield* M.reader.ask();

	return {
		type: "Closure",
		ctx,
		term: yield* quote(ctx.env.length + 1, value),
	};
}
