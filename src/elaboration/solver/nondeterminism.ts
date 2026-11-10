/*
 * Discharged proofs belong to the metacontext that established them, so each candidate forks both.
 * After every candidate succeeds, replay merges shared solutions and intersects their discharged sets.
 * https://github.com/tiansivive/z-yap/blob/main/zettels/nondeterminism.md
 */
import * as Eff from "@yap/utils/effects";

import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "@yap/elaboration/normalization";
import * as Sub from "@yap/elaboration/unification/substitution";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/lib/Array";
import * as R from "fp-ts/lib/Record";
import { mapKeys } from "lodash";

export const replay = function* <T>(action: (zonker: Record<number, NF.Value>) => M.Elaboration<T>): M.Elaboration<T[]> {
	const state = yield* M.st.get();

	if (R.isEmpty(state.nondeterminism.solution)) {
		return [yield* action({})];
	}

	const zonkers = F.pipe(
		state.nondeterminism.solution,
		R.sequence(A.Applicative),
		A.map((values): Record<number, NF.Value> => {
			const z: Record<number, NF.Value> = mapKeys(values, (_, key) => parseInt(key, 10));
			return z;
		}),
	);

	const attempt = function* (z: Record<number, NF.Value>): M.Elaboration<readonly [T, Metas.Registry, ReadonlySet<number>]> {
		const current = yield* Metas.registry.get();
		const [answer, forked, local] = yield* Eff.with([Metas.registry.handlers(Metas.withSolutions(current, Sub.from(z))), M.st.handlers(state)], () =>
			action(z),
		);

		return [answer, forked, local.discharged] as const;
	};

	const outcomes = yield* Eff.traverse(zonkers, attempt);

	yield* Metas.registry.modify(current =>
		Metas.merge(
			current,
			outcomes.map(([, forked]) => forked),
		),
	);

	const [, , firstDischarged = state.discharged] = outcomes[0] ?? [];
	const discharged = new Set([...firstDischarged].filter(id => outcomes.every(([, , solved]) => solved.has(id))));
	yield* M.st.modify(s => ({ ...s, discharged }));

	return outcomes.map(([answer]) => answer);
};
