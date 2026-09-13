/* eslint-disable @typescript-eslint/consistent-type-assertions -- the group is erased to run it; the cast never reaches a call site */

import { Frame } from "./machine/actions";
import type { Evaluation } from "./effects";

/*
 * `let` does not sequence: nothing has run when it is called, so a work cannot read an earlier name.
 * A step that needs an earlier answer belongs in a group of its own, nested inside the `in` that
 * produced it.
 */
type Bindings = Record<string, unknown>;
type Step = { name: string; work: Evaluation<unknown> };

export type Chain<S extends Bindings> = {
	let: <N extends string, T>(name: N, work: Evaluation<T>) => Chain<S & { readonly [P in N]: T }>;
	in: <T>(body: (bindings: S) => Evaluation<T>) => Evaluation<T>;
};

const from = <S extends Bindings>(steps: readonly Step[]): Chain<S> => ({
	let: (name, work) => from([...steps, { name, work }]),
	in: body =>
		Frame.group(
			steps.map(({ work }) => work),
			answers => body(Object.fromEntries(steps.map(({ name }, index) => [name, answers[index]])) as S),
		),
});

/** An empty group: start here. */
export const Do: Chain<Record<never, never>> = from([]);
