// Solver v2 effect runtime: generator RWSE with ST-style state owned by Do.
// RWSE = Reader, Writer, State, Either.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import * as E from "fp-ts/Either";
import type { Either } from "fp-ts/lib/Either";
import type { IVL } from "../ivl/types";
import type * as CDCL from "./cdcl";
import type * as Encoding from "./encoding";
import type * as EUF from "./euf";
import type * as Quantifier from "./quantifier";
import type * as Theory from "./theory";
import type * as Trace from "./trace";

export type Solver<A> = (env: Env, w?: Accumulator, st?: State) => [Collector<A>, State];
export type G<A> = Generator<Solver<any>, A, any>;

export function run<A>(ma: Solver<A>, env: Env = Env.default, st: State = State.initial): [Collector<A>, State] {
	return ma(env, Accumulator.empty, st);
}

export function Do<R>(gen: () => G<R>): Solver<R> {
	return (env, w = Accumulator.empty, initial = State.initial) => {
		const it = gen();

		/* eslint-disable */
		let collected = w;
		let current = initial;
		let step = it.next();

		while (!step.done) {
			const [collector, next] = step.value(env, Accumulator.empty, current);
			collected = Accumulator.concat(collected, collector);
			current = next;

			if (E.isLeft(collector.result)) {
				return [{ ...collected, result: collector.result }, current];
			}
			step = it.next(collector.result.right);
		}
		/* eslint-enable */

		return [{ ...collected, result: E.right(step.value) }, current];
	};
}

export namespace Reader {
	export const ask = function* (): G<Env> {
		return yield (env, _w, st = State.initial) => [Collector.of(env), st];
	};

	export const asks = function* <A>(f: (env: Env) => A): G<A> {
		return yield (env, _w, st = State.initial) => [Collector.of(f(env)), st];
	};

	export const local = function* <A>(modify: (env: Env) => Env, ma: Solver<A>): G<A> {
		return yield (env, w, st = State.initial) => ma(modify(env), w, st);
	};
}

export type Config = {
	maxQuantifierRounds: number;
	maxMbqiTermsPerSort: number;
	trace: "silent" | "collect";
};

export type Env = {
	config: Config;
	problem?: Problem;
};

export type Problem = {
	original: IVL.Formula;
	normalized?: IVL.Formula;
	skolemized?: IVL.Formula;
};

export const Config = {
	default: {
		maxQuantifierRounds: 5,
		maxMbqiTermsPerSort: 10,
		trace: "collect",
	} satisfies Config,
};

export const Env = {
	default: {
		config: Config.default,
	} satisfies Env,
};

export namespace Writer {
	export const listen = function* (): G<Accumulator> {
		return yield (_env, w = Accumulator.empty, st = State.initial) => [Collector.of(w), st];
	};
}
export type Collector<A> = Accumulator & {
	result: Either<Err, A>;
};
export type Accumulator = {
	steps: Trace.Event.T[];
	diagnostics: Trace.Diagnostic[];
	proof: Trace.Proof.Event[];
	stats: Trace.Stats;
};

export const Collector = {
	of: <A>(a: A): Collector<A> => ({
		...Accumulator.empty,
		result: E.right(a),
	}),

	fail: <A>(err: Err): Collector<A> => ({
		...Accumulator.empty,
		result: E.left(err),
	}),
};

export const Accumulator = {
	empty: {
		steps: [],
		diagnostics: [],
		proof: [],
		stats: {
			decisions: 0,
			propagations: 0,
			conflicts: 0,
			quantifierRounds: 0,
		},
	} satisfies Accumulator,

	concat: (a: Accumulator, b: Accumulator): Accumulator => ({
		steps: a.steps.concat(b.steps),
		diagnostics: a.diagnostics.concat(b.diagnostics),
		proof: a.proof.concat(b.proof),
		stats: {
			decisions: a.stats.decisions + b.stats.decisions,
			propagations: a.stats.propagations + b.stats.propagations,
			conflicts: a.stats.conflicts + b.stats.conflicts,
			quantifierRounds: a.stats.quantifierRounds + b.stats.quantifierRounds,
		},
	}),
};

export type State = {
	cdcl: CDCL.State;
	encoding: Encoding.State;
	arena: EUF.Arena.State;
	theories: Theory.State;
	quantifiers: Quantifier.State;
};

export const State = {
	get: function* (): G<State> {
		const r: State = yield (_env, _w, st = State.initial) => [Collector.of(st), st];
		return r;
	},

	put: function* (state: State): G<void> {
		yield (_env, _w, _st = State.initial) => [Collector.of(undefined), state];
	},

	modify: function* (f: (state: State) => State): G<void> {
		yield (_env, _w, st = State.initial) => [Collector.of(undefined), f(st)];
	},
	// Inlined empties avoid core → domain value-import cycles; domain modules import State.modify.
	initial: {
		cdcl: {
			trail: [],
			assignments: new Map(),
			level: 0,
			clauses: { base: [], learned: [], lemmas: [] },
		},
		encoding: {
			clauses: [],
			keyIndex: new Map(),
			atoms: new Map(),
			proxies: new Map(),
			nextVar: 1, // SAT variable base
		},
		arena: {
			nodes: new Map(),
			hashIndex: new Map(),
			nextId: 0,
		},
		theories: {
			euf: {
				uf: new Map(),
				parents: new Map(),
				mergeLog: [],
				registry: new Map(),
				active: new Set(),
				conclusions: [],
				stack: [],
			},
			arithmetic: {
				tableau: { rows: new Map(), basic: new Set(), assignment: new Map(), bounds: new Map() },
				bounds: new Map(),
				integerVars: new Set(),
				constraints: new Map(),
				stack: [],
			},
		},
		quantifiers: {
			quantifiers: [],
			generation: 0,
			instantiated: new Set(),
			phase: { round: 0, pending: [] },
		},
	} satisfies State,
};

export const localSt = function* <A>(modify: (state: State) => State, ma: Solver<A>): G<A> {
	return yield (env, w, st = State.initial) => {
		const [collector] = ma(env, w, modify(st));
		return [collector, st];
	};
};

export type Err = {
	cause: Cause;
	env: Env;
};
export type Cause = { tag: "Invariant"; message: string } | { tag: "Unsupported"; feature: string } | { tag: "ResourceLimit"; resource: string; limit: number };

export namespace Error {
	export const fail = function* <A>(cause: Cause): G<A> {
		const env = yield* Reader.ask();
		return yield* liftC(Collector.fail<A>({ cause, env }));
	};
}

export const of =
	<A>(a: A): Solver<A> =>
	(_env, _w, st = State.initial) => [Collector.of(a), st];

export const lift = function* <A>(a: A): G<A> {
	return yield of(a);
};

export const liftC = function* <A>(collector: Collector<A>): G<A> {
	return yield (_env, _w, st = State.initial) => [collector, st];
};

export const liftE = <A>(e: Either<Err, A>): G<A> => liftC({ ...Accumulator.empty, result: e });
