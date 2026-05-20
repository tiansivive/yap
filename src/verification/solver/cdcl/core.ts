// CDCL: Conflict-Driven Clause Learning — the boolean SAT engine.
// Generator-based: yields Step events at each logical transition for tracing/debugging.
// CDCL = Conflict-Driven Clause Learning, BCP = Boolean Constraint Propagation, 1UIP = First Unique Implication Point

import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import * as A from "fp-ts/Array";
import { pipe } from "fp-ts/function";
import { match } from "ts-pattern";
import type { Theory } from "../theories/theory";
import type { Step } from "../trace";
import { Trace } from "../trace";

export type Variable = number;
export type Literal = number;

export type Clause = {
	readonly id: number;
	readonly literals: readonly Literal[];
	readonly origin: string;
};

export type TrailEntry = {
	readonly literal: Literal;
	readonly level: number;
	readonly reason: Clause | "decision";
};

export type Conflict = { readonly clause: Clause };

export type Assignment = "true" | "false" | "unassigned";

export type CDCLResult =
	| { readonly tag: "sat"; readonly assignments: ReadonlyMap<Variable, Assignment> }
	| { readonly tag: "unsat"; readonly core: readonly Clause[] };

export const Literal = {
	variable: (lit: Literal): Variable => Math.abs(lit),
	polarity: (lit: Literal): boolean => lit > 0,
	negate: (lit: Literal): Literal => -lit,
};

const { variable, polarity, negate } = Literal;

type SolveState = {
	readonly trail: readonly TrailEntry[];
	readonly assignments: ReadonlyMap<Variable, Assignment>;
	readonly level: number;
	readonly clauses: readonly Clause[];
	readonly nextClauseId: number;
};

export const CDCL = {
	solve: (initialClauses: readonly Clause[], theories: readonly Theory[] = []): CDCLResult => Trace.drain(CDCL.solveTrace(initialClauses, theories)),

	solveTrace: function* (initialClauses: readonly Clause[], theories: readonly Theory[] = []): Generator<Step, CDCLResult> {
		const state = initial(initialClauses);
		const bcpResult = yield* bcpTrace(state, theories);

		return yield* match(bcpResult)
			.with({ tag: "conflict" }, function* ({ clause }): Generator<Step, CDCLResult> {
				yield { tag: "conflict", clause };
				const result: CDCLResult = { tag: "unsat", core: initialClauses };
				yield { tag: "unsat", core: initialClauses };
				return result;
			})
			.with({ tag: "ok" }, function* ({ state: propagated }): Generator<Step, CDCLResult> {
				return yield* solveLoop(propagated, theories);
			})
			.exhaustive();
	},
};

const initial = (clauses: readonly Clause[]): SolveState => ({
	trail: [],
	assignments: new Map(extractVariables(clauses).map(v => [v, "unassigned" as const])),
	level: 0,
	clauses,
	nextClauseId: clauses.reduce((max, c) => Math.max(max, c.id), 0) + 1,
});

type BCPResult = { readonly tag: "ok"; readonly state: SolveState } | { readonly tag: "conflict"; readonly clause: Clause };

function* solveLoop(state: SolveState, theories: readonly Theory[]): Generator<Step, CDCLResult> {
	const theoryConflict = yield* checkTheoriesTrace(theories);

	if (theoryConflict) {
		return yield* resolveConflict(state, theoryConflict, theories);
	}

	const lit = decide(state);

	if (lit === undefined) {
		const result: CDCLResult = { tag: "sat", assignments: state.assignments };
		yield { tag: "sat", assignments: state.assignments };
		return result;
	}

	yield { tag: "decide", literal: lit, level: state.level + 1 };
	yield { tag: "theory-push", level: state.level + 1 };

	// Justification for forEach: theory push/pop is inherently side-effecting (external interface)
	theories.forEach(t => t.push());

	const nextState: SolveState = { ...assign(state, lit, "decision"), level: state.level + 1 };
	return yield* propagateAndResolve(nextState, theories);
}

function* propagateAndResolve(state: SolveState, theories: readonly Theory[]): Generator<Step, CDCLResult> {
	const bcpResult = yield* bcpTrace(state, theories);

	return yield* match(bcpResult)
		.with({ tag: "conflict" }, function* ({ clause }): Generator<Step, CDCLResult> {
			yield { tag: "conflict", clause };
			return yield* resolveConflict(state, { clause }, theories);
		})
		.with({ tag: "ok" }, function* ({ state: propagated }): Generator<Step, CDCLResult> {
			const theoryConflict = yield* checkTheoriesTrace(theories);

			if (theoryConflict) {
				return yield* resolveConflict(propagated, theoryConflict, theories);
			}

			return yield* solveLoop(propagated, theories);
		})
		.exhaustive();
}

function* resolveConflict(state: SolveState, conflict: Conflict, theories: readonly Theory[]): Generator<Step, CDCLResult> {
	if (state.level === 0) {
		const result: CDCLResult = { tag: "unsat", core: state.clauses };
		yield { tag: "unsat", core: state.clauses };
		return result;
	}

	const { learned, backtrackLevel } = analyze(state, conflict);

	yield { tag: "analyze", conflict: conflict.clause, learned, backtrackLevel };
	yield { tag: "backjump", from: state.level, to: backtrackLevel };
	yield { tag: "theory-pop", to: backtrackLevel };

	const afterBackjump = backjump({ ...state, clauses: [...state.clauses, learned] }, backtrackLevel, theories);

	const bcpResult = yield* bcpTrace(afterBackjump, theories);

	return yield* match(bcpResult)
		.with({ tag: "conflict" }, function* ({ clause }): Generator<Step, CDCLResult> {
			yield { tag: "conflict", clause };
			return yield* resolveConflict(afterBackjump, { clause }, theories);
		})
		.with({ tag: "ok" }, function* ({ state: propagated }): Generator<Step, CDCLResult> {
			return yield* solveLoop(propagated, theories);
		})
		.exhaustive();
}

function* bcpTrace(state: SolveState, theories: readonly Theory[]): Generator<Step, BCPResult> {
	const unit = classify(state);

	return yield* match(unit)
		.with({ tag: "none" }, function* (): Generator<Step, BCPResult> {
			return { tag: "ok", state };
		})
		.with({ tag: "conflict" }, function* ({ clause }): Generator<Step, BCPResult> {
			return { tag: "conflict", clause };
		})
		.with({ tag: "unit" }, function* ({ literal, reason }): Generator<Step, BCPResult> {
			yield { tag: "propagate", literal, reason };

			const theoryConflict = yield* assertTheoriesTrace(literal, theories);

			if (theoryConflict) {
				return { tag: "conflict", clause: theoryConflict.clause };
			}

			return yield* bcpTrace(assign(state, literal, reason), theories);
		})
		.exhaustive();
}

type ProbeResult = { readonly step: Step; readonly conflict: Conflict | undefined };

const probeAssert = (theory: Theory, literal: Literal): ProbeResult =>
	pipe(
		theory.assert(literal),
		E.match(
			(conflict): ProbeResult => ({
				step: { tag: "theory-assert", theory: theory.name, literal, result: "conflict" },
				conflict,
			}),
			(): ProbeResult => ({
				step: { tag: "theory-assert", theory: theory.name, literal, result: "ok" },
				conflict: undefined,
			}),
		),
	);

const probeCheck = (theory: Theory): ProbeResult =>
	pipe(
		theory.check(),
		E.match(
			(conflict): ProbeResult => ({
				step: { tag: "theory-check", theory: theory.name, result: "conflict" },
				conflict,
			}),
			(): ProbeResult => ({
				step: { tag: "theory-check", theory: theory.name, result: "ok" },
				conflict: undefined,
			}),
		),
	);

function* assertTheoriesTrace(literal: Literal, theories: readonly Theory[]): Generator<Step, Conflict | undefined> {
	return yield* theoryScan(theories, theory => probeAssert(theory, literal));
}

function* checkTheoriesTrace(theories: readonly Theory[]): Generator<Step, Conflict | undefined> {
	return yield* theoryScan(theories, probeCheck);
}

function* theoryScan(theories: readonly Theory[], probe: (theory: Theory) => ProbeResult): Generator<Step, Conflict | undefined> {
	if (theories.length === 0) {
		return undefined;
	}

	const [head, ...tail] = theories;
	const { step, conflict } = probe(head);
	yield step;

	return conflict ?? (yield* theoryScan(tail, probe));
}

type UnitSearch =
	| { readonly tag: "none" }
	| { readonly tag: "conflict"; readonly clause: Clause }
	| { readonly tag: "unit"; readonly literal: Literal; readonly reason: Clause };

const classify = (state: SolveState): UnitSearch =>
	pipe(
		[...state.clauses],
		A.findFirstMap(clause => classifyClause(state.assignments, clause)),
		O.getOrElse((): UnitSearch => ({ tag: "none" })),
	);

const classifyClause = (assignments: ReadonlyMap<Variable, Assignment>, clause: Clause): O.Option<UnitSearch> =>
	clauseSatisfied(assignments, clause)
		? O.none
		: pipe(
				clause.literals.filter(lit => assignmentOf(assignments, lit) === "unassigned"),
				unassigned =>
					match(unassigned.length)
						.with(0, () => O.some<UnitSearch>({ tag: "conflict", clause }))
						.with(1, () => O.some<UnitSearch>({ tag: "unit", literal: unassigned[0], reason: clause }))
						.otherwise(() => O.none),
			);

const assign = (state: SolveState, lit: Literal, reason: Clause | "decision"): SolveState => ({
	...state,
	trail: [...state.trail, { literal: lit, level: state.level, reason }],
	assignments: new Map([...state.assignments, [variable(lit), polarity(lit) ? "true" : "false"]]),
});

const decide = (state: SolveState): Literal | undefined =>
	pipe(
		[...state.assignments.entries()],
		A.findFirst(([_, asgn]) => asgn === "unassigned"),
		O.map(([v]) => v),
		O.toUndefined,
	);

const analyze = (state: SolveState, conflict: Conflict): { learned: Clause; backtrackLevel: number } => {
	const resolvent = computeUIP(state.trail, conflict.clause.literals, state.level);

	const learned: Clause = {
		id: state.nextClauseId,
		literals: resolvent,
		origin: `learned:${conflict.clause.origin}`,
	};

	const backtrackLevel = resolvent
		.filter(lit => trailLevel(state.trail, lit) !== state.level)
		.reduce((max, lit) => Math.max(max, trailLevel(state.trail, lit)), 0);

	return { learned, backtrackLevel };
};

const computeUIP = (trail: readonly TrailEntry[], initial: readonly Literal[], level: number): Literal[] => {
	const currentLevelCount = (lits: readonly Literal[]) => lits.filter(lit => trailLevel(trail, lit) === level).length;

	const step = (resolvent: Literal[], idx: number): Literal[] => {
		if (currentLevelCount(resolvent) <= 1) {
			return resolvent;
		}

		if (idx < 0) {
			return resolvent;
		}

		const entry = trail[idx];

		if (!resolvent.includes(negate(entry.literal))) {
			return step(resolvent, idx - 1);
		}

		if (entry.reason === "decision") {
			return step(resolvent, idx - 1);
		}

		return step(resolve(resolvent, [...entry.reason.literals], entry.literal), idx - 1);
	};

	return step([...initial], trail.length - 1);
};

const backjump = (state: SolveState, targetLevel: number, theories: readonly Theory[]): SolveState => {
	const kept = state.trail.filter(entry => entry.level <= targetLevel);
	const keptAssignments = new Map(kept.map(e => [variable(e.literal), polarity(e.literal) ? ("true" as const) : ("false" as const)]));

	// Justification for forEach: theory pop is inherently side-effecting (external interface)
	theories.forEach(t => t.pop());

	return {
		...state,
		trail: kept,
		assignments: new Map([...state.assignments.keys()].map(v => [v, keptAssignments.get(v) ?? ("unassigned" as const)])),
		level: targetLevel,
	};
};

const assignmentOf = (assignments: ReadonlyMap<Variable, Assignment>, lit: Literal): Assignment => assignments.get(variable(lit)) ?? "unassigned";

const literalSatisfied = (assignments: ReadonlyMap<Variable, Assignment>, lit: Literal): boolean =>
	(polarity(lit) && assignmentOf(assignments, lit) === "true") || (!polarity(lit) && assignmentOf(assignments, lit) === "false");

const clauseSatisfied = (assignments: ReadonlyMap<Variable, Assignment>, clause: Clause): boolean =>
	clause.literals.some(lit => literalSatisfied(assignments, lit));

const extractVariables = (clauses: readonly Clause[]): Variable[] => [...new Set(clauses.flatMap(c => c.literals.map(variable)))];

const trailLevel = (trail: readonly TrailEntry[], lit: Literal): number =>
	pipe(
		trail.find(e => variable(e.literal) === variable(lit)),
		entry => entry?.level ?? 0,
	);

const resolve = (a: readonly Literal[], b: readonly Literal[], pivot: Literal): Literal[] => [
	...new Set([...a.filter(lit => lit !== negate(pivot) && lit !== pivot), ...b.filter(lit => lit !== negate(pivot) && lit !== pivot)]),
];
