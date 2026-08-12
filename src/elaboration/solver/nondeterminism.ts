import * as Eff from "@yap/utils/effects";

import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "@yap/elaboration/normalization";
import * as Sub from "@yap/elaboration/unification/substitution";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/lib/Array";
import * as R from "fp-ts/lib/Record";
import { mapKeys } from "lodash";

/**
 * Runs action once per nondeterministic candidate solution, each under its own
 * forked registry seeded with the candidate; agreed-on solutions merge back.
 */
export const replay = function* <T>(action: (zonker: Record<number, NF.Value>) => M.Elaboration<T>): M.Elaboration<T[]> {
	const ctx = yield* M.reader.ask();
	const state = yield* M.st.get();

	if (R.isEmpty(state.nondeterminism.solution)) {
		return [yield* action(ctx.zonker)];
	}

	const zonkers = F.pipe(
		state.nondeterminism.solution,
		R.sequence(A.Applicative),
		A.map((values): Record<number, NF.Value> => {
			const z: Record<number, NF.Value> = mapKeys(values, (_, key) => parseInt(key, 10));
			return z;
		}),
	);

	const attempt = function* (z: Record<number, NF.Value>): M.Elaboration<readonly [T, Metas.Registry]> {
		const current = yield* Metas.registry.get();
		const [answer, forked] = yield* Eff.with([Metas.registry.handlers(Metas.withSolutions(current, Sub.from(z)))], () => action(z));

		return [answer, forked] as const;
	};

	const outcomes = yield* Eff.traverse(zonkers, attempt);

	yield* Metas.registry.modify(current =>
		Metas.merge(
			current,
			outcomes.map(([, forked]) => forked),
		),
	);

	return outcomes.map(([answer]) => answer);
};
