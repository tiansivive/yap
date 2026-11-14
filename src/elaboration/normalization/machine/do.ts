/* eslint-disable @typescript-eslint/consistent-type-assertions -- the group is erased to run it; the cast never reaches a call site */
import * as Eff from "@yap/utils/effects";

import { cont, fill, type Actions } from "./actions";
import type { Machine } from "./frames";

type Bindings = Record<string, unknown>;

/*
 * A sort of embedded domain-specific language for scheduling machine actions.
 * Inspired by do-notation and trying to preserve linear sequencing of evaluation.
 */
export const notation = <S, C, R extends Eff.AnyAction, D = unknown>(scope: () => Eff.Eff<R, S>) => {
	type Program<T> = Eff.Eff<R | Actions<S, C, D>, T>;
	type Work<T> = () => Program<Machine<T>>;

	const step = function* <T>(work: Work<T>): Program<Machine<T>> {
		return yield* cont(yield* scope(), 0, work);
	};

	const group = function* <A, T>(works: readonly Work<A>[], k: (results: A[]) => Program<Machine<T>>): Program<Machine<T>> {
		const result = yield* cont(yield* scope(), works.length, k);
		yield* Eff.traverse(works.toReversed(), step);

		return result;
	};

	const from = <B extends Bindings>(
		steps: readonly { name: string; work: Work<unknown> }[],
		run: <T>(body: (bindings: Bindings) => Program<Machine<T>>) => Program<Machine<T>> = body => body({}),
	): Chain<R | Actions<S, C, D>, B> => {
		const chain: Chain<R | Actions<S, C, D>, B> = {
			let: (name, work) => from([...steps, { name, work }], run),
			bind: (name, work) => from([], body => chain.in(bindings => group([() => work(bindings)], ([value]) => body({ ...bindings, [name]: value })))),
			in: body =>
				run(bindings =>
					group(
						steps.map(({ work }) => work),
						results => body({ ...bindings, ...Object.fromEntries(steps.map(({ name }, index) => [name, results[index]])) } as B),
					),
				),
		};
		return chain;
	};

	return { result: fill, step, group, Do: from<Record<never, never>>([]) };
};

export type Chain<R extends Eff.AnyAction, B extends Bindings> = {
	let: <N extends string, T>(name: N, work: () => Eff.Eff<R, Machine<T>>) => Chain<R, B & { readonly [P in N]: T }>;
	bind: <N extends string, T>(name: N, work: (bindings: B) => Eff.Eff<R, Machine<T>>) => Chain<R, B & { readonly [P in N]: T }>;
	in: <T>(body: (bindings: B) => Eff.Eff<R, Machine<T>>) => Eff.Eff<R, Machine<T>>;
};
