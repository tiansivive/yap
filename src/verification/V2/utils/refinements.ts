import assert from "assert";
import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as E from "fp-ts/Either";
import * as Q from "@yap/shared/modalities/multiplicity";

import { Liquid } from "../../modalities";

export type ExtractModalitiesFn = (nf: NF.Value, ctx: EB.Context) => NF.Modalities;

export const selfify = (tm: EB.Term, ty: NF.Value, ctx: EB.Context): NF.Value => {
	const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
	const nf = NF.evaluate(ctx, tm);
	const eqTerm = (inner: EB.Context) => EB.DSL.eq(bound, NF.quote(inner, inner.env.length + 1, nf));

	return match(ty)
		.with({ type: "Modal" }, modal => {
			const { liquid } = modal.modalities;
			assert(liquid.type === "Abs" && liquid.binder.type === "Lambda", "Liquid refinement must be an abstraction");

			return NF.Constructors.Modal(modal.value, {
				quantity: modal.modalities.quantity,
				liquid: {
					...liquid,
					closure: {
						...liquid.closure,
						term: EB.DSL.and(liquid.closure.term, eqTerm(liquid.closure.ctx)),
					},
				},
			});
		})
		.with({ type: "Abs" }, () => ty)
		.otherwise(value => {
			const liquid = NF.Constructors.Lambda("v", "Explicit", NF.Constructors.Closure(ctx, eqTerm(ctx)), value);
			return NF.Constructors.Modal(value, {
				quantity: Q.One,
				liquid,
			});
		});
};

export const meet = (ctx: EB.Context, scrutineeTy: NF.Value, patternTy: NF.Value): NF.Value => {
	const s = NF.unwrapNeutral(scrutineeTy);
	const p = NF.unwrapNeutral(patternTy);

	return match([s, p])
		.with([{ type: "Existential" }, P._], ([ex]) => {
			const xtended = EB.bind(ex.body.ctx, { type: "Pi", variable: ex.variable }, ex.annotation);
			const met = meet(xtended, ex.body.value, patternTy);
			return NF.Constructors.Exists(ex.variable, ex.annotation, { ctx: ex.body.ctx, value: met });
		})
		.with([{ type: "Modal" }, { type: "Modal" }], ([sm, pm]) => {
			const sl = sm.modalities.liquid;
			const pl = pm.modalities.liquid;

			assert(sl.type === "Abs" && sl.binder.type === "Lambda", "Scrutinee liquid must be lambda");
			assert(pl.type === "Abs" && pl.binder.type === "Lambda", "Pattern liquid must be lambda");
			assert(sl.closure.type === "Closure" && pl.closure.type === "Closure", "Liquid closures must be closures");

			const conjoined = NF.Constructors.Lambda(
				sl.binder.variable,
				"Explicit",
				NF.Constructors.Closure(sl.closure.ctx, EB.DSL.and(sl.closure.term, pl.closure.term)),
				sl.binder.annotation,
			);

			return NF.Constructors.Modal(sm.value, {
				quantity: sm.modalities.quantity,
				liquid: conjoined,
			});
		})
		.with([{ type: "Modal" }, P._], ([sm]) => {
			const metBase = meet(ctx, sm.value, patternTy);
			return NF.Constructors.Modal(metBase, sm.modalities);
		})
		.with([P._, { type: "Modal" }], ([, pm]) => {
			const metBase = meet(ctx, scrutineeTy, pm.value);
			return NF.Constructors.Modal(metBase, pm.modalities);
		})
		.with(
			[
				{ type: "Abs", binder: { type: "Pi" } },
				{ type: "Abs", binder: { type: "Pi" } },
			],
			([st, pt]) => {
				const metDomain = meet(ctx, st.binder.annotation, pt.binder.annotation);
				const xtended = EB.bind(ctx, st.binder, st.binder.annotation);
				const stBody = NF.apply(st.binder, st.closure, NF.Constructors.Rigid(ctx.env.length));
				const ptBody = NF.apply(pt.binder, pt.closure, NF.Constructors.Rigid(ctx.env.length));
				const metCodomain = meet(xtended, stBody, ptBody);

				return NF.Constructors.Pi(
					st.binder.variable,
					st.binder.icit,
					metDomain,
					NF.Constructors.Closure(xtended, NF.quote(xtended, xtended.env.length, metCodomain)),
				);
			},
		)
		.with(
			[
				{ type: "App", arg: { type: "Row" } },
				{ type: "App", arg: { type: "Row" } },
			],
			([sApp, pApp]) => {
				const metRow = meetRow(ctx, sApp.arg.row, pApp.arg.row);
				return NF.Constructors.App(sApp.func, NF.Constructors.Row(metRow), sApp.icit);
			},
		)
		.otherwise(() => patternTy);
};

export const meetRow = (ctx: EB.Context, sRow: NF.Row, pRow: NF.Row): NF.Row =>
	match([sRow, pRow])
		.with([{ type: "empty" }, P._], () => pRow)
		.with([P._, { type: "empty" }], () => sRow)
		.with([{ type: "variable" }, P._], () => pRow)
		.with([P._, { type: "variable" }], () => sRow)
		.with([{ type: "extension" }, { type: "extension" }], ([sr, pr]): NF.Row => {
			const rewritten = R.rewrite(pRow, sr.label);
			if (E.isLeft(rewritten)) {
				return { type: "extension", label: sr.label, value: sr.value, row: meetRow(ctx, sr.row, pRow) };
			}
			if (rewritten.right.type !== "extension") {
				throw new Error("Rewriting row extension should yield extension");
			}
			const metValue = meet(ctx, sr.value, rewritten.right.value);
			const metRest = meetRow(ctx, sr.row, rewritten.right.row);
			return { type: "extension", label: sr.label, value: metValue, row: metRest };
		})
		.exhaustive();

export const extractModalities: ExtractModalitiesFn = (nf, ctx) =>
	match(nf)
		.with({ type: "Modal" }, m => m.modalities)
		.otherwise(() => ({
			quantity: Q.Many,
			liquid: Liquid.Predicate.NeutralNF(NF.Constructors.Lit({ type: "Atom", value: "Unit" }), ctx),
		}));
