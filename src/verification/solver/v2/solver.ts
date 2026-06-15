// Solver v2 API wires formulas, CNF, CDCL(T), and quantifier rounds into an additive check interface.
// CDCL(T) = Conflict-Driven Clause Learning modulo theories; CNF = Conjunctive Normal Form; MBQI = Model-Based Quantifier Instantiation.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { match, P } from "ts-pattern";
import { Build } from "../ivl/build";
import type { IVL } from "../ivl/types";
import { CDCL, Clause, type Result as CDCLResult } from "./cdcl";
import * as Core from "./core";
import type * as Encoding from "./encoding";
import { CNF, Lookup } from "./encoding/index";
import * as EUF from "./euf";
import * as Formulas from "./formulas";
import * as Quantifier from "./quantifier";
import * as EMatch from "./quantifier/ematch";
import * as MBQI from "./quantifier/mbqi";
import { Trace, type Event as TraceEvent } from "./trace";
import * as Theory from "./theory";

export const Solver = {
	create: (): Instance => {
		const base = Base.create();
		return { ...base, check: () => run(base.combined()).result };
	},

	createTraced: (): Traced => {
		const base = Base.create();
		return { ...base, check: () => run(base.combined()) };
	},

	check: (formula: IVL.Formula): Result => run(formula).result,
};

export type Instance = {
	assert: (formula: IVL.Formula, origin?: string) => void;
	check: () => Result;
	push: () => void;
	pop: () => void;
};

export type Traced = {
	assert: (formula: IVL.Formula, origin?: string) => void;
	check: () => Check;
	push: () => void;
	pop: () => void;
};

export type Check = {
	formula: IVL.Formula;
	result: Result;
	steps: TraceEvent.T[];
	encoding: Encoding.State;
	clauses: Clause.T[];
	arena: EUF.Arena.State;
};

export type Result = { tag: "sat"; model: Model } | { tag: "unsat"; core: string[] } | { tag: "unknown"; reason: string };

export type Model = {
	evaluate: (term: IVL.Term) => O.Option<IVL.Term>;
};

const LIMIT = 5;

const run = (formula: IVL.Formula): Check => {
	const [collector, state] = Core.run(trace(formula), { ...Core.Env.default, problem: { original: formula } });
	const result = E.match(
		(err: Core.Err): Result => ({ tag: "unknown", reason: err.cause.tag }),
		(r: Result): Result => r,
	)(collector.result);
	return {
		formula,
		result,
		steps: collector.steps,
		encoding: state.encoding,
		clauses: Clause.all(state.cdcl.clauses),
		arena: state.arena,
	};
};

const trace = (formula: IVL.Formula): Core.Solver<Result> =>
	Core.Do(function* () {
		const prepared = Formulas.run(formula);
		const encoding = CNF.encode(prepared.propositional);
		const quantifiers = prepared.quantifiers.flatMap(Quantifier.extract);
		return yield* loop(encoding, encoding.clauses, Quantifier.State.from(quantifiers), 0);
	});

const loop = function* (encoding: Encoding.State, clauses: Clause.T[], quantifiers: Quantifier.State, round: number): Core.G<Result> {
	yield* Core.State.modify(s => ({ ...s, quantifiers }));
	yield* Theory.install(encoding);
	const result: CDCLResult = yield CDCL.solveTrace(clauses);
	return yield* settle(encoding, clauses, quantifiers, round, result);
};

const settle = function* (encoding: Encoding.State, clauses: Clause.T[], quantifiers: Quantifier.State, round: number, result: CDCLResult): Core.G<Result> {
	return yield* match(result)
		.with({ tag: "unsat" }, function* ({ core }): Core.G<Result> {
			return { tag: "unsat", core: core.map(clause => clause.origin) };
		})
		.with({ tag: "unknown" }, function* ({ reason }): Core.G<Result> {
			const unknown = { tag: "unknown", reason } satisfies Result;
			yield* Trace.emit(unknown);
			return unknown;
		})
		.with({ tag: "sat" }, function* (): Core.G<Result> {
			return yield* match(quantifiers.quantifiers)
				.with([], () => sat())
				.otherwise(() => instantiate(encoding, clauses, quantifiers, round));
		})
		.exhaustive();
};

const sat = function* (): Core.G<Result> {
	return { tag: "sat", model: Model.empty };
};

const instantiate = (encoding: Encoding.State, clauses: Clause.T[], quantifiers: Quantifier.State, round: number): Core.G<Result> =>
	match(round >= LIMIT)
		.with(true, function* (): Core.G<Result> {
			const result: Result = { tag: "unknown", reason: "quantifier instantiation limit reached" };
			yield* Trace.emit(result);
			return result;
		})
		.with(false, () => ematch(encoding, clauses, quantifiers, round))
		.exhaustive();

const ematch = function* (encoding: Encoding.State, clauses: Clause.T[], quantifiers: Quantifier.State, round: number): Core.G<Result> {
	const s = yield* Core.State.get();
	const next = Ids.from(clauses);
	const result = EMatch.round(
		quantifiers,
		s.arena,
		id => EUF.CC.find(s.theories.euf, id),
		next,
		formula => [...Lookup.literals(encoding, formula)],
	);
	yield* Trace.emit({ tag: "round", round, lemmas: result.lemmas.length });
	return yield* match(result.lemmas)
		.with([], () => mbqi(encoding, clauses, quantifiers, round, s.arena, next))
		.otherwise(lemmas => loop(encoding, [...clauses, ...lemmas.map(lemma => lemma.clause)], result.state, round + 1));
};

const mbqi = function* (
	encoding: Encoding.State,
	clauses: Clause.T[],
	quantifiers: Quantifier.State,
	round: number,
	arena: EUF.Arena.State,
	next: EMatch.Next,
): Core.G<Result> {
	const result = MBQI.round(quantifiers.quantifiers, arena, quantifiers.instantiated, quantifiers.generation, next, formula => [
		...Lookup.literals(encoding, formula),
	]);
	yield* Trace.emit({ tag: "mbqi", round, instantiations: result.instantiations });
	return yield* match(result.lemmas)
		.with([], () => sat())
		.otherwise(lemmas =>
			loop(
				encoding,
				[...clauses, ...lemmas.map(lemma => lemma.clause)],
				{ ...quantifiers, instantiated: new Set([...quantifiers.instantiated, ...result.newKeys]), generation: quantifiers.generation + 1 },
				round + 1,
			),
		);
};

const Model = {
	empty: {
		evaluate: () => O.none,
	} satisfies Model,
};

const Base = {
	create: (): Base.T => {
		// Justification for let: this is the public incremental solver API boundary;
		// assertions and scopes must persist across calls before a pure check run.
		let formulas: IVL.Formula[] = [];
		let stack: IVL.Formula[][] = [];
		return {
			assert: (formula: IVL.Formula, origin?: string) => {
				formulas = [
					...formulas,
					match(origin)
						.with(P.string, o => ({ ...formula, origin: o }))
						.with(undefined, () => formula)
						.exhaustive(),
				];
			},
			push: () => {
				stack = [...stack, [...formulas]];
			},
			pop: () => {
				const top = stack.at(-1);
				stack = stack.slice(0, -1);
				formulas = match(top)
					.with(undefined, () => formulas)
					.otherwise(f => f);
			},
			combined: () => Build.and(...formulas),
		};
	},
};

namespace Base {
	export type T = {
		assert: (formula: IVL.Formula, origin?: string) => void;
		push: () => void;
		pop: () => void;
		combined: () => IVL.Formula;
	};
}

const Ids = {
	from: (clauses: Clause.T[]): EMatch.Next => {
		// Justification for let: quantifier round APIs request fresh clause ids through
		// a callback while preserving deterministic left-to-right allocation.
		let id = clauses.reduce((max, clause) => Math.max(max, clause.id), 0) + 1;
		return () => {
			const next = id;
			id += 1;
			return next;
		};
	},
};
