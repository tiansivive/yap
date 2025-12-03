import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as EB from "@yap/elaboration";
import * as U from "@yap/elaboration/unification";
import * as NF from "@yap/elaboration/normalization";
import { match, P } from "ts-pattern";
import * as Sub from "@yap/elaboration/unification/substitution";
import { Subst } from "@yap/elaboration/unification/substitution";

import * as Err from "@yap/elaboration/shared/errors";

import * as F from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";

import * as Q from "@yap/shared/modalities/multiplicity";
import { WithProvenance } from "../shared/provenance";

import _ from "lodash";
import { update } from "@yap/utils";

export type Constraint =
	| { type: "assign"; left: NF.Value; right: NF.Value; lvl: number }
	//| { type: "usage"; computed: Q.Multiplicity; expected: Q.Multiplicity }
	| { type: "resolve"; meta: EB.Meta; value: NF.Value; implicits: EB.Context["implicits"] };

type Ctaint = WithProvenance<Constraint>;
export const solve = (cs: Array<Ctaint>): V2.Elaboration<{ zonker: Subst; resolutions: Resolutions }> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const unifications = cs.filter(c => c.type === "assign");
		const subst = yield* V2.pure(_solve(unifications, ctx, Sub.empty));
		const zonked = update(ctx, "zonker", z => Sub.compose(subst, z));
		const resolutions = resolve(
			cs.filter(c => c.type === "resolve"),
			zonked,
		);
		const solution = { zonker: subst, resolutions };

		return solution;
	});

const _solve = (cs: Array<Ctaint>, _ctx: EB.Context, subst: Subst): V2.Elaboration<Subst> => {
	if (cs.length === 0) {
		return V2.of(subst);
	}

	const [c, ...rest] = cs;

	return match(c)
		.with({ type: "assign" }, ({ left, right, lvl }) =>
			V2.Do<Subst, Subst>(function* () {
				// Update context zonker with accumulated substitution so unify can force/zonk with current solutions
				const sub = yield* V2.local(ctx => ({ ...ctx, zonker: Sub.compose(subst, ctx.zonker) }), V2.track(c.trace, U.unify(left, right, lvl, subst)));
				const sol = yield _solve(rest, _ctx, sub);
				return sol;
			}),
		)

		.otherwise(() => {
			throw new Error("Solve: Not implemented yet");
		});
};

export type Resolutions = Record<number, EB.Term>;
const resolve = (cs: Array<Extract<Constraint, { type: "resolve" }>>, ctx: EB.Context): Resolutions => {
	const lookup = (implicits: EB.Context["implicits"], nf: NF.Value): EB.Term | void => {
		if (implicits.length === 0) {
			return;
		}

		const [[term, value], ...rest] = implicits;
		const unification = U.unify(nf, value, ctx.env.length, Sub.empty);
		const result = unification(ctx).result;
		if (E.isRight(result)) {
			if (!_.isEmpty(result.right)) {
				throw new Error("resolve: Found implicit with constraints; What to do here?");
			}
			return term;
		}

		return lookup(rest, nf);
	};
	const _resolve = (cs: Array<Extract<Constraint, { type: "resolve" }>>): Resolutions => {
		if (cs.length === 0) {
			return {};
		}

		const [{ implicits, value, meta }, ...rest] = cs;

		if (ctx.zonker[meta.val]) {
			// Already resolved
			return _resolve(rest);
		}

		const found = lookup(implicits, NF.force(ctx, value));

		if (!found) {
			return _resolve(rest);
		}

		const solution = _resolve(rest);
		return { ...solution, [meta.val]: found };
	};
	return _resolve(cs);
};
