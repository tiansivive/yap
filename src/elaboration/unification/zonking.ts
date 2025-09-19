import * as EB from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";

const zonkNF = (nf: NF.Value, ctx: EB.Context): NF.Value => {
	NF.traverse(
		nf,
		v => {
			if (v.variable.type !== "Meta") {
				return v;
			}

			if (!ctx.zonker[v.variable.val]) {
				return v;
			}

			return zonkNF(ctx.zonker[v.variable.val], ctx);
		},
		tm => zonkTM(tm, ctx),
	);

	return 1 as any;
};

const zonkTM = (tm: EB.Term, ctx: EB.Context): EB.Term => {
	return 1 as any;
};
