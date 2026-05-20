// Simplex: dual simplex method for linear arithmetic feasibility.
// Maintains a tableau of basic/non-basic variables with rational bounds.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md
// LRA = Linear Real Arithmetic, BV = Basic Variable, NBV = Non-Basic Variable

import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import * as A from "fp-ts/Array";
import { pipe } from "fp-ts/function";
import { match } from "ts-pattern";
import { Rational } from "./rational";
import type { Literal, Conflict, Clause } from "../../cdcl/core";
import { ArithTrace } from "../theory";

const THEORY_CLAUSE_ID = -2;

export type Bound = {
	readonly value: Rational;
	readonly strict: boolean;
	readonly reason: Literal;
};

export type BoundPair = {
	readonly lower: O.Option<Bound>;
	readonly upper: O.Option<Bound>;
};

export type Row = ReadonlyMap<string, Rational>;

export type Tableau = {
	readonly rows: ReadonlyMap<string, Row>;
	readonly basic: ReadonlySet<string>;
	readonly assignment: ReadonlyMap<string, Rational>;
	readonly bounds: ReadonlyMap<string, BoundPair>;
};

export const Simplex = {
	create: (): Tableau => ({
		rows: new Map(),
		basic: new Set(),
		assignment: new Map(),
		bounds: new Map(),
	}),

	addVariable: (tab: Tableau, name: string): Tableau => ({
		...tab,
		assignment: new Map([...tab.assignment, [name, Rational.zero]]),
		bounds: new Map([...tab.bounds, [name, { lower: O.none, upper: O.none }]]),
	}),

	addRow: (tab: Tableau, slack: string, coefficients: Row): Tableau => {
		const value = [...coefficients.entries()].reduce(
			(acc, [v, c]) => Rational.add(acc, Rational.mul(c, tab.assignment.get(v) ?? Rational.zero)),
			Rational.zero,
		);

		return {
			...tab,
			rows: new Map([...tab.rows, [slack, coefficients]]),
			basic: new Set([...tab.basic, slack]),
			assignment: new Map([...tab.assignment, [slack, value]]),
			bounds: new Map([...tab.bounds, [slack, { lower: O.none, upper: O.none }]]),
		};
	},

	assertLower: (tab: Tableau, variable: string, bound: Bound): E.Either<Conflict, Tableau> => {
		const current = tab.bounds.get(variable) ?? { lower: O.none, upper: O.none };

		return pipe(
			current.upper,
			O.match(
				() => tightenLower(tab, variable, bound, current),
				upper =>
					boundConflict(bound, upper, variable)
						? E.left(conflictFrom(bound.reason, upper.reason, `arith:bound-conflict:${variable}`))
						: tightenLower(tab, variable, bound, current),
			),
		);
	},

	assertUpper: (tab: Tableau, variable: string, bound: Bound): E.Either<Conflict, Tableau> => {
		const current = tab.bounds.get(variable) ?? { lower: O.none, upper: O.none };

		return pipe(
			current.lower,
			O.match(
				() => tightenUpper(tab, variable, bound, current),
				lower =>
					boundConflict(lower, bound, variable)
						? E.left(conflictFrom(lower.reason, bound.reason, `arith:bound-conflict:${variable}`))
						: tightenUpper(tab, variable, bound, current),
			),
		);
	},

	check: (tab: Tableau): E.Either<Conflict, Tableau> => repair(tab),

	checkTrace: function* (tab: Tableau): Generator<ArithTrace.Step, E.Either<Conflict, Tableau>> {
		return yield* repairTrace(tab);
	},

	value: (tab: Tableau, variable: string): Rational => tab.assignment.get(variable) ?? Rational.zero,
};

const boundConflict = (lower: Bound, upper: Bound, _variable: string): boolean =>
	lower.strict || upper.strict ? Rational.geq(lower.value, upper.value) : Rational.gt(lower.value, upper.value);

const conflictFrom = (reason1: Literal, reason2: Literal, origin: string): Conflict => ({
	clause: {
		id: THEORY_CLAUSE_ID,
		literals: [-reason1, -reason2],
		origin,
	},
});

const tightenLower = (tab: Tableau, variable: string, bound: Bound, current: BoundPair): E.Either<Conflict, Tableau> => {
	const shouldTighten = pipe(
		current.lower,
		O.match(
			() => true,
			existing => Rational.gt(bound.value, existing.value),
		),
	);

	if (!shouldTighten) {
		return E.right(tab);
	}

	const updated: Tableau = {
		...tab,
		bounds: new Map([...tab.bounds, [variable, { ...current, lower: O.some(bound) }]]),
	};

	const currentValue = tab.assignment.get(variable) ?? Rational.zero;
	return Rational.lt(currentValue, bound.value) && !tab.basic.has(variable) ? E.right(updateNonBasic(updated, variable, bound.value)) : E.right(updated);
};

const tightenUpper = (tab: Tableau, variable: string, bound: Bound, current: BoundPair): E.Either<Conflict, Tableau> => {
	const shouldTighten = pipe(
		current.upper,
		O.match(
			() => true,
			existing => Rational.lt(bound.value, existing.value),
		),
	);

	if (!shouldTighten) {
		return E.right(tab);
	}

	const updated: Tableau = {
		...tab,
		bounds: new Map([...tab.bounds, [variable, { ...current, upper: O.some(bound) }]]),
	};

	const currentValue = tab.assignment.get(variable) ?? Rational.zero;
	return Rational.gt(currentValue, bound.value) && !tab.basic.has(variable) ? E.right(updateNonBasic(updated, variable, bound.value)) : E.right(updated);
};

// When a non-basic variable's value changes, update all basic variables that reference it
const updateNonBasic = (tab: Tableau, variable: string, newValue: Rational): Tableau => {
	const oldValue = tab.assignment.get(variable) ?? Rational.zero;
	const delta = Rational.sub(newValue, oldValue);

	const updatedAssignment = new Map(tab.assignment);
	updatedAssignment.set(variable, newValue);

	tab.rows.forEach((row, basicVar) => {
		const coeff = row.get(variable);
		if (coeff && !Rational.isZero(coeff)) {
			const current = updatedAssignment.get(basicVar) ?? Rational.zero;
			updatedAssignment.set(basicVar, Rational.add(current, Rational.mul(coeff, delta)));
		}
	});

	return { ...tab, assignment: updatedAssignment };
};

const MAX_PIVOTS = 100;

const repair = (tab: Tableau): E.Either<Conflict, Tableau> => {
	const step = (current: Tableau, pivotCount: number): E.Either<Conflict, Tableau> => {
		if (pivotCount >= MAX_PIVOTS) {
			return E.right(current);
		}

		return pipe(
			findViolation(current),
			O.match(
				() => E.right(current),
				violation =>
					pipe(
						findPivotCandidate(current, violation),
						O.match(
							() => E.left(violationConflict(current, violation)),
							entering => step(pivot(current, violation.variable, entering), pivotCount + 1),
						),
					),
			),
		);
	};

	return step(tab, 0);
};

function* repairTrace(tab: Tableau): Generator<ArithTrace.Step, E.Either<Conflict, Tableau>> {
	const step = function* (current: Tableau, pivotCount: number): Generator<ArithTrace.Step, E.Either<Conflict, Tableau>> {
		if (pivotCount >= MAX_PIVOTS) {
			yield { tag: "feasible" } satisfies ArithTrace.Step;
			return E.right(current);
		}

		const violation = findViolation(current);
		if (O.isNone(violation)) {
			yield { tag: "feasible" } satisfies ArithTrace.Step;
			return E.right(current);
		}

		const v = violation.value;
		const value = current.assignment.get(v.variable) ?? Rational.zero;
		yield { tag: "violation", variable: v.variable, value, direction: v.direction } satisfies ArithTrace.Step;

		const candidate = findPivotCandidate(current, v);
		if (O.isNone(candidate)) {
			yield { tag: "infeasible", variable: v.variable } satisfies ArithTrace.Step;
			return E.left(violationConflict(current, v));
		}

		const entering = candidate.value;
		yield { tag: "pivot", leaving: v.variable, entering } satisfies ArithTrace.Step;
		return yield* step(pivot(current, v.variable, entering), pivotCount + 1);
	};

	return yield* step(tab, 0);
}

type Violation = {
	readonly variable: string;
	readonly direction: "below" | "above";
};

const findViolation = (tab: Tableau): O.Option<Violation> =>
	pipe(
		[...tab.basic],
		A.findFirstMap(v => {
			const value = tab.assignment.get(v) ?? Rational.zero;
			const bp = tab.bounds.get(v) ?? { lower: O.none, upper: O.none };

			return pipe(
				bp.lower,
				O.chain(lower =>
					(lower.strict ? Rational.leq(value, lower.value) : Rational.lt(value, lower.value)) ? O.some({ variable: v, direction: "below" as const }) : O.none,
				),
				O.alt(() =>
					pipe(
						bp.upper,
						O.chain(upper =>
							(upper.strict ? Rational.geq(value, upper.value) : Rational.gt(value, upper.value))
								? O.some({ variable: v, direction: "above" as const })
								: O.none,
						),
					),
				),
			);
		}),
	);

const findPivotCandidate = (tab: Tableau, violation: Violation): O.Option<string> => {
	const row = tab.rows.get(violation.variable);

	if (!row) {
		return O.none;
	}

	return pipe(
		[...row.entries()],
		A.findFirstMap(([nbv, coeff]) => {
			if (tab.basic.has(nbv)) {
				return O.none;
			}

			if (Rational.isZero(coeff)) {
				return O.none;
			}

			return canPivot(tab, nbv, coeff, violation.direction) ? O.some(nbv) : O.none;
		}),
	);
};

const canPivot = (tab: Tableau, nbv: string, coeff: Rational, direction: "below" | "above"): boolean => {
	const value = tab.assignment.get(nbv) ?? Rational.zero;
	const bp = tab.bounds.get(nbv) ?? { lower: O.none, upper: O.none };

	return match(direction)
		.with("below", () => (Rational.isPositive(coeff) && canIncrease(value, bp)) || (Rational.isNegative(coeff) && canDecrease(value, bp)))
		.with("above", () => (Rational.isNegative(coeff) && canIncrease(value, bp)) || (Rational.isPositive(coeff) && canDecrease(value, bp)))
		.exhaustive();
};

const canIncrease = (value: Rational, bp: BoundPair): boolean =>
	pipe(
		bp.upper,
		O.match(
			() => true,
			upper => Rational.lt(value, upper.value),
		),
	);

const canDecrease = (value: Rational, bp: BoundPair): boolean =>
	pipe(
		bp.lower,
		O.match(
			() => true,
			lower => Rational.gt(value, lower.value),
		),
	);

// Justification for mutation: pivot is a hot-path operation rebuilding multiple rows.
// Functional fold over rows would allocate intermediate maps per row; direct mutation
// into fresh maps amortizes allocation.
const pivot = (tab: Tableau, leaving: string, entering: string): Tableau => {
	const row = tab.rows.get(leaving);

	if (!row) {
		return tab;
	}

	const coeff = row.get(entering) ?? Rational.one;
	const invCoeff = Rational.div(Rational.minusOne, coeff);

	// New row for entering: entering = (leaving - sum(c_j * x_j)) / coeff
	const newRow: Map<string, Rational> = new Map();
	newRow.set(leaving, invCoeff);
	row.forEach((c, v) => {
		if (v !== entering) {
			newRow.set(v, Rational.mul(Rational.neg(c), invCoeff));
		}
	});

	// Substitute entering in all other rows
	const updatedRows = new Map(tab.rows);
	updatedRows.delete(leaving);
	updatedRows.set(entering, newRow);

	tab.rows.forEach((r, bv) => {
		if (bv === leaving) {
			return;
		}
		const enterCoeff = r.get(entering);

		if (!enterCoeff || Rational.isZero(enterCoeff)) {
			return;
		}

		const substituted = new Map(r);
		substituted.delete(entering);
		newRow.forEach((nc, nv) => {
			const existing = substituted.get(nv) ?? Rational.zero;
			const combined = Rational.add(existing, Rational.mul(enterCoeff, nc));
			Rational.isZero(combined) ? substituted.delete(nv) : substituted.set(nv, combined);
		});
		updatedRows.set(bv, substituted);
	});

	// Update assignment: move entering to satisfy leaving's bound
	const leavingValue = tab.assignment.get(leaving) ?? Rational.zero;
	const bp = tab.bounds.get(leaving) ?? { lower: O.none, upper: O.none };
	const target = pipe(
		bp.lower,
		O.filter(lower => Rational.lt(leavingValue, lower.value)),
		O.map(lower => lower.value),
		O.alt(() =>
			pipe(
				bp.upper,
				O.filter(upper => Rational.gt(leavingValue, upper.value)),
				O.map(upper => upper.value),
			),
		),
		O.getOrElse(() => leavingValue),
	);
	const delta = Rational.div(Rational.sub(target, leavingValue), coeff);

	const updatedAssignment = new Map(tab.assignment);
	updatedAssignment.set(entering, Rational.add(updatedAssignment.get(entering) ?? Rational.zero, delta));
	updatedAssignment.set(leaving, target);

	// Adjust all other basic variables
	updatedRows.forEach((r, bv) => {
		if (bv === entering) {
			return;
		}
		const enterCoeff = r.get(entering);
		if (enterCoeff) {
			updatedAssignment.set(bv, Rational.add(updatedAssignment.get(bv) ?? Rational.zero, Rational.mul(enterCoeff, delta)));
		}
	});

	const updatedBasic = new Set(tab.basic);
	updatedBasic.delete(leaving);
	updatedBasic.add(entering);

	return {
		rows: updatedRows,
		basic: updatedBasic,
		assignment: updatedAssignment,
		bounds: tab.bounds,
	};
};

const boundReasons = (bp: BoundPair): readonly Literal[] => [
	...pipe(
		bp.lower,
		O.match(
			() => [] as Literal[],
			b => [-b.reason],
		),
	),
	...pipe(
		bp.upper,
		O.match(
			() => [] as Literal[],
			b => [-b.reason],
		),
	),
];

const violationConflict = (tab: Tableau, violation: Violation): Conflict => {
	const bp = tab.bounds.get(violation.variable) ?? { lower: O.none, upper: O.none };
	const row = tab.rows.get(violation.variable);

	const rowReasons = row ? [...row.keys()].flatMap(nbv => boundReasons(tab.bounds.get(nbv) ?? { lower: O.none, upper: O.none })) : [];

	return {
		clause: {
			id: THEORY_CLAUSE_ID,
			literals: [...new Set([...boundReasons(bp), ...rowReasons])],
			origin: `arith:infeasible:${violation.variable}`,
		},
	};
};
