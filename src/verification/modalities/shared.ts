import * as Q from "@yap/shared/modalities/multiplicity";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { Solver, Expr } from "z3-solver";
import assert from "node:assert";

export type Annotations<T> = {
	quantity: Q.Multiplicity;
	liquid: T;
};

export type Artefacts = {
	/** Usage information for each variable in the context */
	usages: Q.Usages;
	/** Verification Condition */
	vc: Expr;
};

export const Verification = {
	implication: (p: NF.Value, q: NF.Value): NF.Value => NF.DSL.Binop.or(NF.DSL.Unop.not(p), q),

	imply: (ctx: EB.Context, ann: NF.Value, p: EB.Term, q: NF.Value): NF.Value => {
		// const head = NF.reduce(p, NF.Constructors.Var({ type: "Bound", lvl: ctx.env.length -1}), "Explicit");
		// const body = Verification.implication(head, q);

		const x = EB.Constructors.Var({ type: "Bound", index: 0 });
		const tm = EB.Constructors.App("Explicit", p, x);

		const extended = EB.bind(ctx, { type: "Lambda", variable: "$x" }, ann, "inserted");
		// const c = NF.quote(extended, extended.env.length, NF.DSL.Unop.not(q));
		// const and = EB.DSL.or(tm, c);
		const c = NF.quote(extended, extended.env.length, q);
		const and = EB.DSL.and(tm, c);

		return NF.Constructors.Lambda("$x", "Explicit", NF.Constructors.Closure(ctx, and), ann);
	},
};

export const combine = (a: Annotations<NF.Value>, b: Annotations<NF.Value>, ctx: EB.Context): Annotations<NF.Value> => ({
	quantity: Q.SR.mul(a.quantity, b.quantity),
	liquid: (() => {
		assert(a.liquid.type === "Abs" && a.liquid.binder.type === "Lambda", "Expected liquid annotation to be a Lambda abstraction");
		assert(b.liquid.type === "Abs" && b.liquid.binder.type === "Lambda", "Expected liquid annotation to be a Lambda abstraction");

		const name = `${a.liquid.binder.variable}_and_${b.liquid.binder.variable}`;
		const lvl = ctx.env.length;
		const anf = NF.apply(a.liquid.binder, a.liquid.closure, NF.Constructors.Rigid(lvl));
		const bnf = NF.apply(b.liquid.binder, b.liquid.closure, NF.Constructors.Rigid(lvl));

		const body = NF.DSL.Binop.and(anf, bnf);
		return NF.Constructors.Lambda(name, "Explicit", NF.Constructors.Closure(ctx, NF.quote(ctx, lvl + 1, body)), a.liquid.binder.annotation);
		// return NF.DSL.Binop.and(a.liquid, b.liquid);
	})(),
});
