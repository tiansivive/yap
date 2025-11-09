import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as EB from "@yap/elaboration";
import * as U from "@yap/elaboration/unification";
import * as NF from "@yap/elaboration/normalization";
import { match, P } from "ts-pattern";
import * as Sub from "@yap/elaboration/unification/substitution";
import { Subst } from "@yap/elaboration/unification/substitution";

import * as Err from "@yap/elaboration/shared/errors";

import * as F from "fp-ts/lib/function";

import * as Q from "@yap/shared/modalities/multiplicity";
import { WithProvenance } from "../shared/provenance";

export type Constraint =
	| { type: "assign"; left: NF.Value; right: NF.Value; lvl: number }
	| { type: "usage"; computed: Q.Multiplicity; expected: Q.Multiplicity };
//| { type: "resolve"; meta: Extract<EB.Variable, { type: "Meta" }>; annotation: NF.Value };
// | { type: "sigma"; lvl: number; dict: Record<string, NF.Value> }

type Ctaint = WithProvenance<Constraint>;
export const solve = (cs: Array<Ctaint>): V2.Elaboration<Subst> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const solution = yield* V2.pure(_solve(cs, ctx, Sub.empty));

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
		.with({ type: "usage" }, ({ expected, computed }) => {
			return match([expected, computed])
				.with(["One", "One"], ["Many", P._], ["Zero", "Zero"], () => _solve(rest, _ctx, subst))
				.otherwise(() => V2.Do(() => V2.fail<Subst>(Err.MultiplicityMismatch(expected, computed))));
		})
		.otherwise(() => {
			throw new Error("Solve: Not implemented yet");
		});
};
