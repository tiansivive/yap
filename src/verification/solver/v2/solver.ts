// Solver v2 API wires formulas, CNF, CDCL(T), and quantifier rounds into an additive check interface.
// CDCL(T) = Conflict-Driven Clause Learning modulo theories; CNF = Conjunctive Normal Form; MBQI = Model-Based Quantifier Instantiation.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { match } from "ts-pattern";
import type { IVL } from "../ivl/types";
import { CDCL, Clause, type Result as CDCLResult } from "./cdcl";
import * as Core from "./core";
import type * as Encoding from "./encoding";
import { CNF } from "./encoding";
import type * as EUF from "./euf";
import * as Formulas from "./formulas";
import * as Quantifier from "./quantifier";
import * as Trace from "./trace";
import * as Theory from "./theory";

const LIMIT = 5;

export const Solver = {
	run: (formula: IVL.Formula): Check => run(formula),
	check: (formula: IVL.Formula): Result => Solver.run(formula).result,
};

export type Check = {
	formula: IVL.Formula;
	result: Result;
	steps: Trace.Event.T[];
	encoding: Encoding.State;
	clauses: Clause.T[];
	arena: EUF.Arena.State;
};

export type Result = { tag: "sat"; model: Model } | { tag: "unsat"; core: string[] } | { tag: "unknown"; reason: string };

export type Model = {
	evaluate: (term: IVL.Term) => O.Option<IVL.Term>;
};

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
		yield* Core.State.modify(s => ({ ...s, encoding, quantifiers: Quantifier.State.from(quantifiers) }));
		return yield* loop(encoding.clauses);
	});

const loop = function* (clauses: Clause.T[]): Core.G<Result> {
	const state = yield* Core.State.get();
	yield* Theory.install(state.encoding);
	const result = yield* Core.pure(CDCL.solveTrace(clauses));
	return yield* settle(clauses, result);
};

const settle = function* (clauses: Clause.T[], result: CDCLResult): Core.G<Result> {
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
			const state = yield* Core.State.get();
			return yield* match(state.quantifiers.quantifiers)
				.with([], () => sat())
				.otherwise(() => instantiate(clauses));
		})
		.exhaustive();
};

const Model = {
	empty: {
		evaluate: () => O.none,
	} satisfies Model,
};

const sat = function* (): Core.G<Result> {
	return { tag: "sat", model: Model.empty };
};

const instantiate = function* (clauses: Clause.T[]): Core.G<Result> {
	const state = yield* Core.State.get();
	return yield* match(state.quantifiers.phase.round >= LIMIT)
		.with(true, function* (): Core.G<Result> {
			const result: Result = { tag: "unknown", reason: "quantifier instantiation limit reached" };
			yield* Trace.emit(result);
			return result;
		})
		.with(false, function* (): Core.G<Result> {
			const step = yield* Quantifier.Round.step();
			return yield* match(step)
				.with({ tag: "saturated" }, () => sat())
				.with({ tag: "lemmas" }, ({ clauses: additions }) => loop([...clauses, ...additions]))
				.exhaustive();
		})
		.exhaustive();
};
