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

const Bool = () => NF.Constructors.Lit(Lit.Atom("Bool"));
const State = () => NF.Constructors.Lit(Lit.Atom("State"));

type Program<A> = Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Only<typeof Metas.registry, "Registry.get">, A>;

type Predicate = {
	Kind: (arg: NF.Value) => Program<NF.Value>;
	Lambda: (ann: NF.Value, body: EB.Term) => Program<NF.Value>;
	Body: (liquid: NF.Value) => Program<EB.Term>;
	apply: (liquid: NF.Value, state: NF.Value, value: NF.Value) => Program<NF.Value>;
	Neutral: (ann: NF.Value) => Program<EB.Term>;
	NeutralNF: (ann: NF.Value) => Program<NF.Value>;
};

/*
 * A refinement is a predicate over the verifier's state and a value, taken in that order, so that
 * `\st -> p` refines with a predicate `p` over values alone.
 */
export const Predicate: Predicate = {
	Kind: function* (arg) {
		const value = NF.Constructors.Pi(fresh(), "Explicit", arg, yield* NF.closeVal(Bool()));
		return NF.Constructors.Pi(fresh(), "Explicit", State(), yield* NF.closeVal(value));
	},

	/* `body` sits under both binders: index 1 is the state and index 0 the value. */
	Lambda: function* (ann, body) {
		const ctx = yield* M.reader.ask();
		const value = EB.Constructors.Lambda(fresh(), "Explicit", body, yield* NF.quote(ctx.env.length + 1, ann));
		return NF.Constructors.Lambda(fresh(), "Explicit", NF.Constructors.Closure(ctx, value), State());
	},

	/* A refinement's body as a term for `Lambda`, so that refinements combine without nesting applications. */
	Body: function* (liquid) {
		const lvl = (yield* M.reader.ask()).env.length;
		return yield* NF.quote(lvl + 2, yield* Predicate.apply(liquid, NF.Constructors.Rigid(lvl), NF.Constructors.Rigid(lvl + 1)));
	},

	apply: function* (liquid, state, value) {
		return yield* NF.reduce(yield* NF.reduce(liquid, state, "Explicit"), value, "Explicit");
	},

	Neutral: function* (ann) {
		const ctx = yield* M.reader.ask();
		return yield* NF.quote(ctx.env.length, yield* Predicate.NeutralNF(ann));
	},

	NeutralNF: ann => Predicate.Lambda(ann, EB.Constructors.Lit(Lit.Bool(true))),
};
