import assert from "assert";
import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as E from "fp-ts/Either";
import * as Q from "@yap/shared/modalities/multiplicity";

import { Liquid } from "../../modalities";

import { reader, type Verification } from "../effects";

export type ExtractModalitiesFn = (nf: NF.Value, ctx: EB.Context) => Verification<NF.Modalities>;

export const selfify = function* (tm: EB.Term, ty: NF.Value): Verification<NF.Value> {
	if (!(yield* isFirstOrder(ty))) {
		return ty;
	}

	const ctx = yield* reader.ask();
	const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
	const nf = yield* NF.evaluate(tm);

	return yield* match(yield* NF.view(ty))
		.with(NF.View.Sealed(NF.Patterns.Modal), function* ({ value: modal }) {
			const { liquid } = modal.modalities;
			assert(liquid.type === "Abs" && liquid.binder.type === "Lambda", "Liquid refinement must be an abstraction");

			const quoted = yield* NF.quote(liquid.closure.ctx.env.length + 1, nf);
			return NF.Constructors.Modal(modal.value, {
				quantity: modal.modalities.quantity,
				liquid: {
					...liquid,
					closure: {
						...liquid.closure,
						term: EB.DSL.and(liquid.closure.term, EB.DSL.eq(bound, quoted)),
					},
				},
			});
		})
		.otherwise(function* () {
			const value = yield* NF.force(ty);
			const quoted = yield* NF.quote(ctx.env.length + 1, nf);
			const liquid = NF.Constructors.Lambda("v", "Explicit", NF.Constructors.Closure(ctx, EB.DSL.eq(bound, quoted)), value);
			return NF.Constructors.Modal(value, {
				quantity: Q.One,
				liquid,
			});
		});
};

export const meet = function* (scrutineeTy: NF.Value, patternTy: NF.Value): Verification<NF.Value> {
	const ctx = yield* reader.ask();
	return yield* match([yield* NF.view(scrutineeTy), yield* NF.view(patternTy)])
		.with([NF.View.Sealed({ type: "Existential" }), P._], function* ([{ value: ex }]) {
			const met = yield* reader.local(c => EB.bind(ex.body.ctx, { type: "Pi", variable: ex.variable }, ex.annotation), meet(ex.body.value, patternTy));
			return NF.Constructors.Exists(ex.variable, ex.annotation, { ctx: ex.body.ctx, value: met });
		})
		.with([NF.View.Sealed(NF.Patterns.Modal), NF.View.Sealed(NF.Patterns.Modal)], function* ([{ value: sm }, { value: pm }]) {
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
		.with([NF.View.Sealed(NF.Patterns.Modal), P._], function* ([{ value: sm }]) {
			const metBase = yield* meet(sm.value, patternTy);
			return NF.Constructors.Modal(metBase, sm.modalities);
		})
		.with([P._, NF.View.Sealed(NF.Patterns.Modal)], function* ([, { value: pm }]) {
			const metBase = yield* meet(scrutineeTy, pm.value);
			return NF.Constructors.Modal(metBase, pm.modalities);
		})
		.with([NF.View.Sealed(NF.Patterns.Pi), NF.View.Sealed(NF.Patterns.Pi)], function* ([{ value: st }, { value: pt }]) {
			const metDomain = yield* meet(st.binder.annotation, pt.binder.annotation);
			const stBody = yield* NF.apply(st.binder, st.closure, NF.Constructors.Rigid(ctx.env.length));
			const ptBody = yield* NF.apply(pt.binder, pt.closure, NF.Constructors.Rigid(ctx.env.length));
			const metCodomain = yield* reader.local(c => EB.bind(c, st.binder, st.binder.annotation), meet(stBody, ptBody));

			const xtended = EB.bind(ctx, st.binder, st.binder.annotation);
			const quoted = yield* NF.quote(xtended.env.length, metCodomain);
			return NF.Constructors.Pi(st.binder.variable, st.binder.icit, metDomain, NF.Constructors.Closure(xtended, quoted));
		})
		.with(
			[NF.View.Sealed({ type: "App", arg: { type: "Row" } }), NF.View.Sealed({ type: "App", arg: { type: "Row" } })],
			function* ([{ value: sApp }, { value: pApp }]) {
				const metRow = yield* meetRow(sApp.arg.row, pApp.arg.row);
				return NF.Constructors.App(sApp.func, NF.Constructors.Row(metRow), sApp.icit);
			},
		)
		.otherwise(function* () {
			return patternTy;
		});
};

export const meetRow = function* (sRow: NF.Row, pRow: NF.Row): Verification<NF.Row> {
	return yield* match([sRow, pRow])
		.with([{ type: "empty" }, P._], function* () {
			return pRow;
		})
		.with([P._, { type: "empty" }], function* () {
			return sRow;
		})
		.with([{ type: "variable" }, P._], function* () {
			return pRow;
		})
		.with([P._, { type: "variable" }], function* () {
			return sRow;
		})
		.with([{ type: "extension" }, { type: "extension" }], function* ([sr, _pr]): Verification<NF.Row> {
			const rewritten = R.rewrite(pRow, sr.label);
			if (E.isLeft(rewritten)) {
				const rest = yield* meetRow(sr.row, pRow);
				return { type: "extension", label: sr.label, value: sr.value, row: rest };
			}
			if (rewritten.right.type !== "extension") {
				throw new Error("Rewriting row extension should yield extension");
			}
			const metValue = yield* meet(sr.value, rewritten.right.value);
			const metRest = yield* meetRow(sr.row, rewritten.right.row);
			return { type: "extension", label: sr.label, value: metValue, row: metRest };
		})
		.exhaustive();
};

export const extractModalities: ExtractModalitiesFn = function* (nf, ctx) {
	return match(yield* NF.view(nf))
		.with(NF.View.Sealed(NF.Patterns.Modal), ({ value }) => value.modalities)
		.otherwise(() => ({
			quantity: Q.Many,
			liquid: Liquid.Predicate.NeutralNF(NF.Constructors.Lit({ type: "Atom", value: "Unit" }), ctx),
		}));
};

export const isFirstOrder = function* (ty: NF.Value): Verification<boolean> {
	return yield* match(yield* NF.view(ty))
		.with(NF.View.Sealed(NF.Patterns.Modal), ({ value }) => isFirstOrder(value.value))
		.with(NF.View.Sealed(P.union(NF.Patterns.Pi, NF.Patterns.Lambda, NF.Patterns.Sigma, NF.Patterns.SigmaV2, NF.Patterns.Nu)), function* () {
			return false;
		})
		.otherwise(function* () {
			return true;
		});
};
