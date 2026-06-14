/* eslint-disable @typescript-eslint/no-namespace */
// No-theory CDCL search loop for v2 over already encoded CNF clauses.
// CDCL = Conflict-Driven Clause Learning; CNF = Conjunctive Normal Form.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import { match, P } from "ts-pattern";
import * as Core from "../core";
import { Trace } from "../trace";
import { analyze } from "./analyze";
import * as BCP from "./bcp";
import { Clause, type Conflict, type Literal, Literal as Lit, type Result, type State, Trail, State as Search } from "./model";

export namespace CDCL {
	export const solve = (clauses: Clause.T[]): Result => {
		const [collector] = Core.run(solveTrace(clauses));
		return match(collector.result)
			.with({ _tag: "Right" }, ({ right }) => right)
			.with({ _tag: "Left" }, ({ left }) => ({ tag: "unknown" as const, reason: left.cause.tag }))
			.exhaustive();
	};

	export const solveTrace = (clauses: Clause.T[]): Core.Solver<Result> =>
		Core.Do(function* () {
			const state = Search.initial(clauses);
			const propagated = yield* BCP.propagate(state);
			return yield* match(propagated)
				.with({ tag: "conflict" }, function* ({ clause }): Core.G<Result> {
					yield* Trace.emit({ tag: "conflict", clause });
					const result: Result = { tag: "unsat", core: clauses };
					yield* Trace.emit(result);
					return result;
				})
				.with({ tag: "ok" }, ({ state }) => loop(state))
				.exhaustive();
		});
}

const loop = (state: State): Core.G<Result> =>
	match(decide(state))
		.with(P.number, function* (literal): Core.G<Result> {
			const level = state.level + 1;
			yield* Trace.emit({ tag: "decide", literal, level });
			return yield* propagate(resolveDecision(state, literal));
		})
		.with(undefined, function* (): Core.G<Result> {
			const result: Result = { tag: "sat", assignments: state.assignments };
			yield* Trace.emit(result);
			return result;
		})
		.exhaustive();

const propagate = function* (state: State): Core.G<Result> {
	const result = yield* BCP.propagate(state);
	return yield* match(result)
		.with({ tag: "ok" }, ({ state }) => loop(state))
		.with({ tag: "conflict" }, function* ({ state, clause }): Core.G<Result> {
			yield* Trace.emit({ tag: "conflict", clause });
			return yield* resolve(state, { clause });
		})
		.exhaustive();
};

const resolve = (state: State, conflict: Conflict): Core.G<Result> =>
	match(state.level)
		.with(0, function* (): Core.G<Result> {
			const result: Result = { tag: "unsat", core: Clause.all(state.clauses) };
			yield* Trace.emit(result);
			return result;
		})
		.otherwise(function* (): Core.G<Result> {
			const { learned, backtrackLevel } = analyze(state, conflict);
			yield* Trace.emit({ tag: "analyze", conflict: conflict.clause, learned, backtrackLevel });
			yield* Trace.emit({ tag: "backjump", from: state.level, to: backtrackLevel });
			return yield* propagate(Search.backjump(Search.learn(state, learned), backtrackLevel));
		});

const resolveDecision = (state: State, literal: Literal): State => Search.assign(Search.enter(state), literal, Trail.Reason.decision);

const decide = (state: State): Literal | undefined => [...state.assignments.entries()].find(([, assignment]) => assignment === "unassigned")?.[0];
