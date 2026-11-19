import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";
import { match, P } from "ts-pattern";

const tru = () => NF.Constructors.Lit({ type: "Bool", value: true });
const fls = () => NF.Constructors.Lit({ type: "Bool", value: false });

export const Constants = { tru, fls };

let count = 0;
const fresh = () => {
	++count;
	return `$r${count}`;
};

type Predicate = {
	Kind: (arg: NF.Value) => Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Actions<typeof Metas.registry>, NF.Value>;
	Neutral: (ann: EB.Term) => EB.Term;
	NeutralNF: (ann: NF.Value, ctx: EB.Context) => NF.Value;
};

export const Predicate: Predicate = {
	Kind: function* (arg: NF.Value) {
		const closure = yield* NF.closeVal(NF.Constructors.Lit(Lit.Atom("Bool")));
		return NF.Constructors.Pi(fresh(), "Explicit", arg, closure);
	},
	Neutral: (ann: EB.Term) => {
		return EB.Constructors.Lambda(fresh(), "Explicit", EB.Constructors.Lit({ type: "Bool", value: true }), ann);
	},

	NeutralNF: (ann: NF.Value, ctx: EB.Context) => {
		const closure = NF.Constructors.Closure(ctx, EB.Constructors.Lit(Lit.Bool(true)));
		return NF.Constructors.Lambda(fresh(), "Explicit", closure, ann);
	},
};

export const firstOrder = function* (type: NF.Value): Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Actions<typeof Metas.registry>, boolean> {
	return yield* match(yield* NF.view(type))
		.with(NF.View.Sealed(NF.Patterns.Modal), ({ value }) => firstOrder(value.value))
		.with(NF.View.Sealed(P.union(NF.Patterns.Psi, NF.Patterns.Pi, NF.Patterns.Lambda, NF.Patterns.Sigma, NF.Patterns.SigmaV2, NF.Patterns.Nu)), function* () {
			return false;
		})
		.otherwise(function* () {
			return true;
		});
};

export const expected = function* (type: NF.Value): Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Actions<typeof Metas.registry>, NF.Value> {
	const ctx = yield* M.reader.ask();
	return yield* match(yield* NF.view(type))
		.with(NF.View.Sealed(NF.Patterns.Psi), function* ({ value }) {
			const requirement = value.binder.requirement ?? NF.Constructors.Lambda("s", "Explicit", NF.Constructors.Closure(ctx, EB.DSL.bool(true)), NF.State);
			const body = yield* NF.apply(value.binder, value.closure, NF.Constructors.Rigid(ctx.env.length));
			const fixed = yield* M.reader.local(c => EB.bind(c, value.binder, NF.State), expected(body));
			return NF.Constructors.Psi(value.binder.variable, requirement, yield* NF.closeVal(fixed));
		})
		.with(NF.View.Sealed(NF.Patterns.Pi), function* ({ value }) {
			const annotation = yield* match(yield* NF.view(value.binder.annotation))
				.with(NF.View.Sealed(P.union(NF.Patterns.Modal, NF.Patterns.Type, NF.Patterns.Phi)), function* () {
					return value.binder.annotation;
				})
				.otherwise(function* () {
					return (yield* firstOrder(value.binder.annotation))
						? NF.Constructors.Modal(value.binder.annotation, {
								quantity: Q.Many,
								liquid: NF.Constructors.Lambda("v", "Explicit", NF.Constructors.Closure(ctx, EB.DSL.bool(true)), value.binder.annotation),
							})
						: value.binder.annotation;
				});
			const body = yield* NF.apply(value.binder, value.closure, NF.Constructors.Rigid(ctx.env.length));
			const fixed = yield* M.reader.local(c => EB.bind(c, value.binder, annotation), expected(body));
			return NF.Constructors.Pi(value.binder.variable, value.binder.icit, annotation, yield* NF.closeVal(fixed));
		})
		.with(NF.View.Sealed(NF.Patterns.Phi), function* ({ value }) {
			const body = yield* NF.apply(value.binder, value.closure, NF.Constructors.Rigid(ctx.env.length));
			const fixed = yield* M.reader.local(c => EB.bind(c, value.binder, value.binder.annotation), expected(body));
			return NF.Constructors.Phi(value.binder.variable, value.binder.annotation, yield* NF.closeVal(fixed));
		})
		.otherwise(function* () {
			return type;
		});
};
