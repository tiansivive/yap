/* eslint-disable @typescript-eslint/no-namespace */
// CDCL v2 domain model: solver-owned boolean search state.
// CDCL = Conflict-Driven Clause Learning; BCP = Boolean Constraint Propagation.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import * as Core from "../core";

export type Variable = number;
export type Literal = number;

export type Assignment = "true" | "false" | "unassigned";

export namespace Clause {
	export type T = {
		id: number;
		literals: Literal[];
		origin: string;
	};

	export type DB = {
		base: T[];
		learned: T[];
		lemmas: T[];
	};

	export type Kind = keyof DB;

	export const empty: DB = { base: [], learned: [], lemmas: [] };

	export const all = (db: DB): T[] => [...db.base, ...db.learned, ...db.lemmas];

	export const add = (kind: Kind, clause: T) =>
		Core.State.modify(s => ({
			...s,
			cdcl: { ...s.cdcl, clauses: Clause.insert(s.cdcl.clauses, kind, clause) },
		}));

	export const insert = (db: DB, kind: Kind, clause: T): DB => ({
		...db,
		[kind]: [...db[kind], clause],
	});

	export const next = function* (): Core.G<number> {
		const s = yield* Core.State.get();
		const id = s.cdcl.nextClauseId;
		yield* Core.State.modify(st => ({ ...st, cdcl: { ...st.cdcl, nextClauseId: id + 1 } }));
		return id;
	};
}

export type Clause = Clause.T;

export type Conflict = {
	clause: Clause.T;
};

export namespace Trail {
	export namespace Reason {
		export type T = { tag: "decision" } | { tag: "clause"; clause: Clause.T };

		export const decision: T = { tag: "decision" };

		export const clause = (clause: Clause.T): T => ({ tag: "clause", clause });
	}

	export type Entry = {
		literal: Literal;
		level: number;
		reason: Reason.T;
	};

	export const assign = (literal: Literal, reason: Reason.T) =>
		Core.State.modify(s => ({
			...s,
			cdcl: State.assign(s.cdcl, literal, reason),
		}));

	export const clear = Core.State.modify(s => ({
		...s,
		cdcl: { ...s.cdcl, trail: [], assignments: reset(s.cdcl.assignments), level: 0 },
	}));
}

export type State = {
	trail: Trail.Entry[];
	assignments: Map<Variable, Assignment>;
	level: number;
	clauses: Clause.DB;
	nextClauseId: number;
};

export type Result = { tag: "sat"; assignments: Map<Variable, Assignment> } | { tag: "unsat"; core: Clause.T[] } | { tag: "unknown"; reason: string };

export namespace Event {
	export type T =
		| { tag: "propagate"; literal: Literal; reason: Clause.T }
		| { tag: "conflict"; clause: Clause.T }
		| { tag: "decide"; literal: Literal; level: number }
		| { tag: "analyze"; conflict: Clause.T; learned: Clause.T; backtrackLevel: number }
		| { tag: "backjump"; from: number; to: number };
}

export type Event = Event.T;

export const Literal = {
	variable: (lit: Literal): Variable => Math.abs(lit),
	polarity: (lit: Literal): boolean => lit > 0,
	negate: (lit: Literal): Literal => -lit,
	assignment: (lit: Literal): Assignment => (Literal.polarity(lit) ? "true" : "false"),
};

export const State = {
	initial: (clauses: Clause.T[]): State => ({
		trail: [],
		assignments: new Map(variables(clauses).map(v => [v, "unassigned" as const])),
		level: 0,
		clauses: { ...Clause.empty, base: clauses },
		nextClauseId: clauses.reduce((max, c) => Math.max(max, c.id), 0) + 1,
	}),

	empty: {
		trail: [],
		assignments: new Map(),
		level: 0,
		clauses: Clause.empty,
		nextClauseId: 0,
	} satisfies State,

	replace: (cdcl: State) => Core.State.modify(s => ({ ...s, cdcl })),

	enter: (state: State): State => ({ ...state, level: state.level + 1 }),

	assign: (state: State, literal: Literal, reason: Trail.Reason.T): State => ({
		...state,
		trail: [...state.trail, { literal, level: state.level, reason }],
		assignments: new Map([...state.assignments, [Literal.variable(literal), Literal.assignment(literal)]]),
	}),

	learn: (state: State, clause: Clause.T): State => ({
		...state,
		clauses: Clause.insert(state.clauses, "learned", clause),
		nextClauseId: Math.max(state.nextClauseId, clause.id + 1),
	}),

	backjump: (state: State, level: number): State => {
		const trail = state.trail.filter(entry => entry.level <= level);
		const assigned = trail.reduce<Map<Variable, Assignment>>(
			(acc, entry) => new Map([...acc, [Literal.variable(entry.literal), Literal.assignment(entry.literal)]]),
			new Map(),
		);

		return {
			...state,
			trail,
			assignments: new Map([...state.assignments.keys()].map(v => [v, assigned.get(v) ?? "unassigned"])),
			level,
		};
	},

	jump: (level: number) => Core.State.modify(s => ({ ...s, cdcl: State.backjump(s.cdcl, level) })),
};

const reset = (assignments: Map<Variable, Assignment>): Map<Variable, Assignment> => new Map([...assignments.keys()].map(v => [v, "unassigned" as const]));

const variables = (clauses: Clause.T[]): Variable[] => [...new Set(clauses.flatMap(c => c.literals.map(Literal.variable)))];
