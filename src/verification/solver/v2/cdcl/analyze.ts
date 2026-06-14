// CDCL conflict analysis: resolve implication reasons until a 1UIP-style learned clause remains.
// CDCL = Conflict-Driven Clause Learning; 1UIP = First Unique Implication Point.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import { match, P } from "ts-pattern";
import { type Clause, type Conflict, Literal, type State, Trail } from "./model";

export const analyze = (state: State, conflict: Conflict): Result => {
	const resolvent = compute(state.trail, conflict.clause.literals, state.level);
	const learned: Clause.T = {
		id: state.nextClauseId,
		literals: resolvent,
		origin: `learned:${conflict.clause.origin}`,
	};
	const backtrackLevel = resolvent.filter(lit => level(state.trail, lit) !== state.level).reduce((max, lit) => Math.max(max, level(state.trail, lit)), 0);

	return { learned, backtrackLevel };
};

export type Result = {
	learned: Clause.T;
	backtrackLevel: number;
};

const compute = (trail: Trail.Entry[], initial: Literal[], level: number): Literal[] => {
	const count = (lits: Literal[]): number => lits.filter(lit => trailLevel(trail, lit) === level).length;

	const step = (resolvent: Literal[], idx: number): Literal[] =>
		match([count(resolvent) <= 1, idx < 0, trail[idx]] as const)
			.with([true, P._, P._], () => resolvent)
			.with([P._, true, P._], () => resolvent)
			.with([P._, P._, P.nullish], () => resolvent)
			.with([false, false, P._], ([, , entry]) =>
				match([resolvent.includes(Literal.negate(entry.literal)), entry.reason] as const)
					.with([false, P._], () => step(resolvent, idx - 1))
					.with([true, { tag: "decision" }], () => step(resolvent, idx - 1))
					.with([true, { tag: "clause" }], ([, reason]) => step(resolve(resolvent, reason.clause.literals, entry.literal), idx - 1))
					.exhaustive(),
			)
			.exhaustive();

	return step(initial, trail.length - 1);
};

const level = (trail: Trail.Entry[], lit: Literal): number => trailLevel(trail, lit);

const trailLevel = (trail: Trail.Entry[], lit: Literal): number => trail.find(e => Literal.variable(e.literal) === Literal.variable(lit))?.level ?? 0;

const resolve = (a: Literal[], b: Literal[], pivot: Literal): Literal[] => [
	...new Set([...a.filter(lit => lit !== Literal.negate(pivot) && lit !== pivot), ...b.filter(lit => lit !== Literal.negate(pivot) && lit !== pivot)]),
];
