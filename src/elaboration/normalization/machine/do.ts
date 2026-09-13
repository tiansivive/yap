/* eslint-disable @typescript-eslint/consistent-type-assertions -- the group is erased to run it; the cast never reaches a call site */
import * as Eff from "@yap/utils/effects";

import { cont, fill, type Actions } from "./actions";

type Bindings = Record<string, unknown>;

/*
 * A sort of embedded domain-specific language for scheduling machine actions.
 * Inspired by do-notation and trying to preserve linear sequencing of evaluation.
 */
export const notation = <S, C, R extends Eff.AnyAction>(scope: () => Eff.Eff<R, S>) => {
	type Program<T> = Eff.Eff<R | Actions<S, C>, T>;

	type Chain<B extends Bindings> = {
		let: <N extends string, T>(name: N, work: Program<T>) => Chain<B & { readonly [P in N]: T }>;
		in: <T>(body: (bindings: B) => Program<T>) => Program<T>;
	};

	const step = function* <T>(work: Program<T>): Program<T> {
		return yield* cont(yield* scope(), 0, () => work);
	};

	const group = function* <A, T>(works: readonly Program<A>[], k: (results: A[]) => Program<T>): Program<T> {
		const result = yield* cont(yield* scope(), works.length, k);
		yield* Eff.traverse(works.toReversed(), step);

		return result;
	};

	const from = <B extends Bindings>(steps: readonly { name: string; work: Program<unknown> }[]): Chain<B> => ({
		let: (name, work) => from([...steps, { name, work }]),
		in: body =>
			group(
				steps.map(({ work }) => work),
				results => body(Object.fromEntries(steps.map(({ name }, index) => [name, results[index]])) as B),
			),
	});

	return { result: fill, step, group, Do: from<Record<never, never>>([]) };
};
