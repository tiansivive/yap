import * as EB from "@yap/elaboration";
import { M } from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as Q from "@yap/shared/modalities/multiplicity";

type Hole = Extract<Src.Term, { type: "hole" }>;

export const infer = (_: Hole): EB.M.Elaboration<EB.AST> =>
	M.chain(M.ask(), ctx => {
		const kind = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
		const meta = EB.Constructors.Var(EB.freshMeta(ctx.env.length, kind));
		const ty = NF.evaluate(ctx, meta);
		// const modal = NF.infer(env, annotation);
		return M.of<EB.AST>([meta, ty, Q.noUsage(ctx.env.length)]);
	});
