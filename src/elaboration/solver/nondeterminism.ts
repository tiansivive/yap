import * as NF from "@yap/elaboration/normalization";

import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/lib/Array";
import * as R from "fp-ts/lib/Record";
import { mapKeys } from "lodash";

export const replay = function* <T>(action: (zonker: Record<number, NF.Value>) => V2.Elaboration<T>): Generator<V2.Elaboration<any>, T[], any> {
	const ctx = yield* V2.ask();
	const state = yield* V2.getSt();

	if (R.isEmpty(state.nondeterminism.solution)) {
		return [yield* V2.pure(action(ctx.zonker))];
	}

	const zonkers = F.pipe(
		state.nondeterminism.solution,
		R.sequence(A.Applicative),
		A.map((values): Record<number, NF.Value> => {
			const z: Record<number, NF.Value> = mapKeys(values, (_, key) => parseInt(key, 10));
			return z;
		}),
	);

	const answers: T[] = [];
	for (const z of zonkers) {
		const answer = yield* V2.pure(action(z));
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
