import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Sub from "@yap/elaboration/unification/substitution";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/lib/Array";
import * as E from "fp-ts/lib/Either";
import * as R from "fp-ts/lib/Record";
import { mapKeys } from "lodash";
import { update } from "@yap/utils";
import { unify } from "../unification";

export const replay = function* <T>(
	action: (zonker: Record<number, NF.Value>, skolems: V2.MutState["skolems"]) => V2.Elaboration<T>,
): Generator<V2.Elaboration<any>, T[], any> {
	const ctx = yield* V2.ask();
	const state = yield* V2.getSt();

	if (R.isEmpty(state.nondeterminism.solution)) {
		return [yield* V2.pure(action(ctx.zonker, state.skolems))];
	}

	const zonkers = F.pipe(
		state.nondeterminism.solution,
		R.sequence(A.Applicative),
		A.map((skolems): Record<number, NF.Value> => {
			const z: Record<number, NF.Value> = mapKeys(skolems, (_, key) => parseInt(key, 10));
			//const zonked = update(ctx, "zonker", old => ({ ...old, ...z }))
			return z;
		}),
	);

	const answers: T[] = [];
	for (const z of zonkers) {
		const answer = yield action(z, state.skolems);
		answers.push(answer);
	}

	return answers;
	// return F.pipe(
	//     A.zipWith(answers, answers.slice(1), (v1, v2) => unify(v1, v2, ctx.env.length, Sub.empty)(ctx)),
	//     A.map(([{ result }]) => result),
	//     E.sequenceArray,
	//     E.map(_ => answers[0])
	// )
};
