import { match, P } from "ts-pattern";
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

type InputRequest = Extract<EB.Term, { type: "Modal" }> & { modalities: { liquid: EB.Term } };

type Predicate = {
	isInputRequest: (annotation: EB.Term, registry: Metas.Registry) => annotation is InputRequest;
	open: (domain: NF.Value, state?: NF.Value) => Inference<EB.Term>;
	Kind: (arg: NF.Value) => Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Actions<typeof Metas.registry>, NF.Value>;
	Neutral: (ann: EB.Term) => EB.Term;
	NeutralNF: (ann: NF.Value, ctx: EB.Context) => NF.Value;
};

export const Predicate: Predicate = {
	isInputRequest: (annotation, registry): annotation is InputRequest => {
		const atState = { type: "App", func: P.select(EB.CtorPatterns.Vars.Meta), arg: EB.CtorPatterns.Vars.Bound } as const;
		const applied = { type: "App", func: atState, arg: { type: "Var", variable: { type: "Bound", index: 0 } } } as const;
		const request = { ...EB.CtorPatterns.Lambda, body: applied };
		return match(annotation)
			.with({ type: "Modal", modalities: { liquid: request } }, ({ variable }) => Metas.lookup(registry, variable.val)?.kind === "Predicate")
			.otherwise(() => false);
	},
	open: function* (domain, state) {
		const ctx = yield* M.reader.ask();
		const lvl = ctx.env.length;
		const unary = yield* Predicate.Kind(domain);
		const kind = state ? NF.Constructors.Pi("s", "Explicit", NF.State, yield* NF.closeVal(unary)) : unary;
		const meta = EB.Constructors.Var(yield* Metas.fresh(lvl, kind, "Predicate"));
		const predicate = state ? EB.Constructors.App("Explicit", meta, yield* NF.quote(lvl + 1, state)) : meta;
		const annotation = yield* NF.quote(lvl, domain);
		return EB.Constructors.Lambda("v", "Explicit", EB.Constructors.App("Explicit", predicate, EB.DSL.bound(0)), annotation);
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
