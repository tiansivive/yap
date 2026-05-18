// CDCL: Conflict-Driven Clause Learning — the boolean SAT engine.
// Implements decide, BCP (unit propagation), 1UIP conflict analysis, and backjumping.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md
// CDCL = Conflict-Driven Clause Learning, BCP = Boolean Constraint Propagation, 1UIP = First Unique Implication Point

import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import * as A from "fp-ts/Array";
import { pipe } from "fp-ts/function";
import { match } from "ts-pattern";
import type { Theory } from "../theories/theory";

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
export type Propagation = E.Either<Conflict, readonly Literal[]>;

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
	solve: (initialClauses: readonly Clause[], theories: readonly Theory[] = []): CDCLResult =>
		pipe(
			bcp(initial(initialClauses)),
			E.match(
				() => ({ tag: "unsat" as const, core: initialClauses }),
				state => solveLoop(state, theories),
			),
		),
};

const initial = (clauses: readonly Clause[]): SolveState => ({
	trail: [],
	assignments: new Map(extractVariables(clauses).map(v => [v, "unassigned" as const])),
	level: 0,
	clauses,
	nextClauseId: clauses.reduce((max, c) => Math.max(max, c.id), 0) + 1,
});

const solveLoop = (state: SolveState, theories: readonly Theory[]): CDCLResult =>
	pipe(
		decide(state),
		O.match(
			() => ({ tag: "sat" as const, assignments: state.assignments }),
			lit => {
				theories.forEach(t => t.push());
				return propagateAndResolve({ ...assign(state, lit, "decision"), level: state.level + 1 }, theories);
			},
		),
	);

const propagateAndResolve = (state: SolveState, theories: readonly Theory[]): CDCLResult =>
	pipe(
		bcp(state),
		E.match(
			conflict => resolveConflict(state, conflict, theories),
			propagated =>
				pipe(
					checkTheories(propagated, theories),
					O.match(
						() => solveLoop(propagated, theories),
						conflict => resolveConflict(propagated, conflict, theories),
					),
				),
		),
	);

const resolveConflict = (state: SolveState, conflict: Conflict, theories: readonly Theory[]): CDCLResult => {
	if (state.level === 0) {
		return { tag: "unsat", core: state.clauses };
	}

	const { learned, backtrackLevel } = analyze(state, conflict);
	const afterBackjump = backjump({ ...state, clauses: [...state.clauses, learned] }, backtrackLevel, theories);

	return pipe(
		bcp(afterBackjump),
		E.match(
			rebcpConflict => resolveConflict(afterBackjump, rebcpConflict, theories),
			propagated => solveLoop(propagated, theories),
		),
	);
};

const bcp = (state: SolveState): E.Either<Conflict, SolveState> =>
	pipe(classify(state), unit =>
		match(unit)
			.with({ tag: "none" }, () => E.right(state))
			.with({ tag: "conflict" }, ({ clause }) => E.left({ clause }))
			.with({ tag: "unit" }, ({ literal, reason }) => bcp(assign(state, literal, reason)))
			.exhaustive(),
	);

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

const checkTheories = (_state: SolveState, theories: readonly Theory[]): O.Option<Conflict> =>
	pipe(
		theories,
		A.findFirstMap(theory =>
			pipe(
				theory.check(),
				E.match(
					conflict => O.some(conflict),
					_propagations => O.none,
				),
			),
		),
	);

const assign = (state: SolveState, lit: Literal, reason: Clause | "decision"): SolveState => ({
	...state,
	trail: [...state.trail, { literal: lit, level: state.level, reason }],
	assignments: new Map([...state.assignments, [variable(lit), polarity(lit) ? "true" : "false"]]),
});

const decide = (state: SolveState): O.Option<Literal> =>
	pipe(
		[...state.assignments.entries()],
		A.findFirst(([_, asgn]) => asgn === "unassigned"),
		O.map(([v]) => v as Literal),
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
