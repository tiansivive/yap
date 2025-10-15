import * as Q from "@yap/shared/modalities/multiplicity";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { Solver, Expr } from "z3-solver";

export type Annotations = {
	quantity: Q.Multiplicity;
	liquid: EB.Term;
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
