// Boolean Constraint Propagation for v2 CDCL using the v1 scan-based clause classifier.
// BCP = Boolean Constraint Propagation; watched literals remain deferred by plan.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import { match, P } from "ts-pattern";
import { Clause, type Assignment, type Literal, Literal as Lit, type State, type Variable } from "./model";

export const classify = (state: State): Unit =>
	Clause.all(state.clauses)
		.map(clause => classifyClause(state.assignments, clause))
		.find((unit): unit is Exclude<Unit, { tag: "none" }> => unit.tag !== "none") ?? { tag: "none" };

export type Unit = { tag: "none" } | { tag: "conflict"; clause: Clause.T } | { tag: "unit"; literal: Literal; reason: Clause.T };

const classifyClause = (assignments: Map<Variable, Assignment>, clause: Clause.T): Unit =>
	match(satisfied(assignments, clause))
		.with(true, () => ({ tag: "none" }) satisfies Unit)
		.with(false, () =>
			match(clause.literals.filter(lit => assignment(assignments, lit) === "unassigned"))
				.with([], () => ({ tag: "conflict", clause }) satisfies Unit)
				.with([P.select()], literal => ({ tag: "unit", literal, reason: clause }) satisfies Unit)
				.otherwise(() => ({ tag: "none" }) satisfies Unit),
		)
		.exhaustive();

const assignment = (assignments: Map<Variable, Assignment>, lit: Literal): Assignment => assignments.get(Lit.variable(lit)) ?? "unassigned";

const satisfied = (assignments: Map<Variable, Assignment>, clause: Clause.T): boolean => clause.literals.some(lit => literal(assignments, lit));

const literal = (assignments: Map<Variable, Assignment>, lit: Literal): boolean =>
	(Lit.polarity(lit) && assignment(assignments, lit) === "true") || (!Lit.polarity(lit) && assignment(assignments, lit) === "false");
