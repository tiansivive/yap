import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

import * as Q from "@yap/shared/modalities/multiplicity";
import * as Lit from "@yap/shared/literals";
import * as Sub from "@yap/elaboration/unification/substitution";

const tru = () => NF.Constructors.Lit({ type: "Bool", value: true });
const fls = () => NF.Constructors.Lit({ type: "Bool", value: false });

export const Constants = { tru, fls };

let count = 0;
const fresh = () => {
	++count;
	return `$r${count}`;
};
export const Predicate = {
	Kind: (ctx: EB.Context, arg: NF.Value) => NF.Constructors.Pi(fresh(), "Explicit", arg, NF.closeVal(ctx, NF.Constructors.Lit(Lit.Atom("Bool")))),
	Neutral: (ty: NF.Value) => EB.Constructors.Lambda(fresh(), "Explicit", EB.Constructors.Lit({ type: "Bool", value: true }), ty),

	NeutralNF: (ty: NF.Value) => {
		const dummyContext: EB.Context = {
			env: [],
			implicits: [],
			sigma: {},
			trace: [],
			imports: {},
			zonker: Sub.empty,
			ffi: {},
			metas: {},
		};
		return NF.evaluate(dummyContext, Predicate.Neutral(ty));
	},
};
