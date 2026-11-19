import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as Lit from "@yap/shared/literals";

const tru = () => NF.Constructors.Lit({ type: "Bool", value: true });
const fls = () => NF.Constructors.Lit({ type: "Bool", value: false });

export const Constants = { tru, fls };

let count = 0;
const fresh = () => {
	++count;
	return `$r${count}`;
};

type Inference<A> = Eff.Eff<Eff.Actions<typeof M.reader | typeof M.supply | typeof Metas.registry>, A>;

type Predicate = {
	hole: (domain: NF.Value, psiState?: NF.Value) => Inference<EB.Term>;
	Kind: (arg: NF.Value) => Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Actions<typeof Metas.registry>, NF.Value>;
	Neutral: (ann: EB.Term) => EB.Term;
	NeutralNF: (ann: NF.Value, ctx: EB.Context) => NF.Value;
};

export const Predicate: Predicate = {
	hole: function* (domain, psiState) {
		const lvl = (yield* M.reader.ask()).env.length;
		const unary = yield* Predicate.Kind(domain);
		const kind = psiState ? NF.Constructors.Pi("s", "Explicit", NF.State, yield* NF.closeVal(unary)) : unary;
		const meta = EB.Constructors.Var(yield* Metas.fresh(lvl, kind, "Predicate"));
		return psiState ? EB.Constructors.App("Explicit", meta, yield* NF.quote(lvl, psiState)) : meta;
	},
	Kind: function* (arg: NF.Value) {
		const closure = yield* NF.closeVal(NF.Constructors.Lit(Lit.Atom("Bool")));
		return NF.Constructors.Pi("v", "Explicit", arg, closure);
	},
	Neutral: (ann: EB.Term) => {
		return EB.Constructors.Lambda(fresh(), "Explicit", EB.Constructors.Lit({ type: "Bool", value: true }), ann);
	},

	NeutralNF: (ann: NF.Value, ctx: EB.Context) => {
		const closure = NF.Constructors.Closure(ctx, EB.Constructors.Lit(Lit.Bool(true)));
		return NF.Constructors.Lambda(fresh(), "Explicit", closure, ann);
	},
};
