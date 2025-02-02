import * as F from "fp-ts/lib/function";

import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import * as Q from "@qtt/shared/modalities/multiplicity";

import * as NF from "@qtt/elaboration/normalization";
import * as Src from "@qtt/src/index";

type Pi = Extract<Src.Term, { type: "pi" } | { type: "arrow" }>;

export const infer = (pi: Pi): EB.M.Elaboration<EB.AST> => {
	const v = pi.type === "pi" ? pi.variable : `t${EB.getVarCount()}`;
	const body = pi.type === "pi" ? pi.body : pi.rhs;
	const ann = pi.type === "pi" ? pi.annotation : pi.lhs;
	const q = pi.type === "pi" && pi.multiplicity ? pi.multiplicity : Q.Many;

	return F.pipe(
		M.Do,
		M.bind("ctx", M.ask),
		M.let("ann", EB.check(ann, NF.Type)),
		M.bind("body", ({ ann: [ann], ctx }) => {
			const va = NF.evaluate(ctx.env, ctx.imports, ann);
			const mva: NF.ModalValue = [va, q];
			const ctx_ = EB.bind(ctx, v, mva);
			return M.local(ctx_, EB.check(body, NF.Type));
		}),
		M.fmap(({ ann: [ann, aus], body: [body, [, ...busTail]] }) => [EB.Constructors.Pi(v, pi.icit, q, ann, body), NF.Type, Q.add(aus, busTail)]),
	);
};
