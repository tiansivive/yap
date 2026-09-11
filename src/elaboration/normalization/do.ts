/* eslint-disable @typescript-eslint/consistent-type-assertions -- the builder erases its accumulator to run it; the casts never reach a call site */
import type * as NF from "./syntax/term";
import { Frame, type Answers, type Kind, type Evaluation } from "./callstack";

/*
 * Sequencing. A chain names each answer it binds, so a later step reads every earlier one by name
 * rather than through nested closures, and the steps read in the order they run. One bind is one
 * frame — the same shape the hand-written pair has, with the ordering fixed by construction.
 */
type Bindings = Record<string, unknown>;
type Step = { name: string; kind: Kind; make: (bindings: Bindings) => Evaluation<void> };

const walk = function* (steps: readonly Step[], bindings: Bindings, last: (bindings: Bindings) => Evaluation<void>): Evaluation<void> {
	const [head, ...rest] = steps;

	if (!head) {
		yield* last(bindings);
		return;
	}

	yield* Frame.cont(head.kind, 1, function* ([value]) {
		yield* walk(rest, { ...bindings, [head.name]: value }, last);
	});

	yield* head.make(bindings);
};

/*
 * `bind` takes its kind first, where a parameter that decides a type belongs, and overloads it
 * away: a step with no kind binds a value, which is what almost every step binds.
 */
export type Chain<S extends Bindings> = {
	/** Runs `make`, binding its answer to `name` for every step after it. */
	bind: {
		<N extends string>(name: N, make: (bindings: S) => Evaluation<void>): Chain<S & { readonly [P in N]: NF.Value }>;
		<K extends Kind, N extends string>(kind: K, name: N, make: (bindings: S) => Evaluation<void>): Chain<S & { readonly [P in N]: Answers[K] }>;
	};
	/** Ends the chain by running `f` over everything it bound. */
	chain: (f: (bindings: S) => Evaluation<void>) => Evaluation<void>;
};

const from = <S extends Bindings>(steps: readonly Step[]): Chain<S> => {
	function bind<N extends string>(name: N, make: (bindings: S) => Evaluation<void>): Chain<S & { readonly [P in N]: NF.Value }>;
	function bind<K extends Kind, N extends string>(kind: K, name: N, make: (bindings: S) => Evaluation<void>): Chain<S & { readonly [P in N]: Answers[K] }>;
	function bind(...args: [string, (bindings: S) => Evaluation<void>] | [Kind, string, (bindings: S) => Evaluation<void>]) {
		const [kind, name, make] = args.length === 2 ? (["value", args[0], args[1]] as const) : args;

		return from([...steps, { name, kind, make: bindings => make(bindings as S) }]);
	}

	return { bind, chain: f => walk(steps, {}, bindings => f(bindings as S)) };
};

/** An empty chain: start here. */
export const Do: Chain<Record<never, never>> = from([]);
