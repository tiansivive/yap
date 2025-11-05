import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

import * as Q from "@yap/shared/modalities/multiplicity";
import * as Lit from "@yap/shared/literals";
import * as Sub from "@yap/elaboration/unification/substitution";

import * as Modal from "@yap/verification/modalities/shared";
import { Context } from "z3-solver";
import { defaultContext } from "@yap/shared/lib/primitives";

import * as Z3 from "z3-solver";

const tru = () => NF.Constructors.Lit({ type: "Bool", value: true });
const fls = () => NF.Constructors.Lit({ type: "Bool", value: false });

export const Constants = { tru, fls };

let count = 0;
const fresh = () => {
	++count;
	return `$r${count}`;
};

type Predicate = {
	Kind: (ctx: EB.Context, arg: NF.Value) => NF.Value;
	Neutral: (ann: EB.Term) => EB.Term;
	NeutralNF: (ann: NF.Value, ctx: EB.Context) => NF.Value;
	True: (Z3: Context<"main">) => Z3.Bool;
};

export const Predicate: Predicate = {
	Kind: (ctx: EB.Context, arg: NF.Value) => NF.Constructors.Pi(fresh(), "Explicit", arg, NF.closeVal(ctx, NF.Constructors.Lit(Lit.Atom("Bool")))),
	Neutral: (ann: EB.Term) => {
		return EB.Constructors.Lambda(fresh(), "Explicit", EB.Constructors.Lit({ type: "Bool", value: true }), ann);
	},

	NeutralNF: (ann: NF.Value, ctx: EB.Context) => {
		const closure = NF.Constructors.Closure(ctx, EB.Constructors.Lit(Lit.Bool(true)));
		return NF.Constructors.Lambda(fresh(), "Explicit", closure, ann);
	},

	True: (Z3: Context<"main">) => Z3.Bool.val(true),
};
