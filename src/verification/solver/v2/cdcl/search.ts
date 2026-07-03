// CDCL(T) search loop for v2 over already encoded CNF clauses.
// Boolean propagation via BCP.classify; theory assert/check on assignments and fixpoints;
// conflict analysis; theory stack restoration on backjump.
// CDCL = Conflict-Driven Clause Learning; CNF = Conjunctive Normal Form.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import { match, P } from "ts-pattern";
import * as E from "fp-ts/Either";
import * as Core from "../core";
import * as Theory from "../theory";
import * as Trace from "../trace";
import { analyze } from "./analyze";
import * as BCP from "./bcp";
import { Clause, type Conflict, type Literal, type Result, type State, Trail, State as Search } from "./model";

export namespace CDCL {
	export const solve = (clauses: Clause.T[]): Result => {
		const [collector] = Core.run(solveTrace(clauses));
		return E.match(
			(left: Core.Err) => ({ tag: "unknown" as const, reason: left.cause.tag }),
			(right: Result) => right,
		)(collector.result);
	};

	export const solveTrace = (clauses: Clause.T[]): Core.Solver<Result> =>
		Core.Do(function* () {
			const state = Search.initial(clauses);
			yield* Search.replace(state);
			return yield* propagate(state);
		});
}

const propagate = function* (state: State): Core.G<Result> {
	yield* Search.replace(state);
	return yield* match(BCP.classify(state))
		.with({ tag: "none" }, () => loop(state))
		.with({ tag: "conflict" }, function* ({ clause }): Core.G<Result> {
			yield* Trace.emit({ tag: "conflict", clause });
			return yield* resolve(state, { clause });
		})
		.with({ tag: "unit" }, function* ({ literal, reason }): Core.G<Result> {
			yield* Trace.emit({ tag: "propagate", literal, reason });
			const assigned = Search.assign(state, literal, Trail.Reason.clause(reason));
			const conflict = yield* Theory.assert(literal);
			return yield* match(conflict)
				.with(P.nonNullable, c => resolve(assigned, c))
				.with(undefined, () => propagate(assigned))
				.exhaustive();
		})
		.exhaustive();
};

const loop = function* (state: State): Core.G<Result> {
	yield* Search.replace(state);
	const conflict = yield* Theory.check();
	return yield* match(conflict)
		.with(P.nonNullable, c => resolve(state, c))
		.with(undefined, () =>
			match(decide(state))
				.with(P.number, literal => decideAndPropagate(state, literal))
				.with(undefined, function* (): Core.G<Result> {
					const result: Result = { tag: "sat", assignments: state.assignments };
					yield* Trace.emit(result);
					return result;
				})
				.exhaustive(),
		)
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
			yield* Theory.backtrack(state.level, backtrackLevel);
			return yield* propagate(Search.backjump(Search.learn(state, learned), backtrackLevel));
		});

const decideAndPropagate = function* (state: State, literal: Literal): Core.G<Result> {
	const level = state.level + 1;
	yield* Trace.emit({ tag: "decide", literal, level });
	yield* Theory.enter(level);
	const assigned = Search.assign(Search.enter(state), literal, Trail.Reason.decision);
	const conflict = yield* Theory.assert(literal);
	return yield* match(conflict)
		.with(P.nonNullable, c => resolve(assigned, c))
		.with(undefined, () => propagate(assigned))
		.exhaustive();
};

const decide = (state: State): Literal | undefined => [...state.assignments.entries()].find(([, assignment]) => assignment === "unassigned")?.[0];
