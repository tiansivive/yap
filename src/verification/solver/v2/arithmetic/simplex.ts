// Dual simplex: linear arithmetic feasibility via rational-bounded tableau repair.
// LRA = Linear Real Arithmetic; BV = Basic Variable; NBV = Non-Basic Variable.
// Values and bounds are δ-rationals, so a strict bound is the non-strict bound one δ inside it.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import * as E from "fp-ts/Either";
import type { Either } from "fp-ts/lib/Either";
import { match } from "ts-pattern";
import type { Conflict, Literal } from "../cdcl";
import { Delta } from "./delta";
import { Rational } from "./rational";

const MAX_PIVOTS = 100;

export const Simplex = {
	empty: {
		rows: new Map(),
		basic: new Set(),
		assignment: new Map(),
		bounds: new Map(),
	} satisfies Tableau,

	variable: (tab: Tableau, name: string): Tableau => ({
		...tab,
		assignment: new Map([...tab.assignment, [name, Delta.zero]]),
		bounds: new Map([...tab.bounds, [name, Bound.Pair.empty]]),
	}),

	row: (tab: Tableau, slack: string, coefficients: Row): Tableau => {
		const value = [...coefficients.entries()].reduce((acc, [v, c]) => Delta.add(acc, Delta.scale(tab.assignment.get(v) ?? Delta.zero, c)), Delta.zero);
		return {
			...tab,
			rows: new Map([...tab.rows, [slack, coefficients]]),
			basic: new Set([...tab.basic, slack]),
			assignment: new Map([...tab.assignment, [slack, value]]),
			bounds: new Map([...tab.bounds, [slack, Bound.Pair.empty]]),
		};
	},

	lower: (tab: Tableau, variable: string, bound: Bound.Input): Check => tighten(tab, variable, bound, "lower"),

	upper: (tab: Tableau, variable: string, bound: Bound.Input): Check => tighten(tab, variable, bound, "upper"),

	check: (tab: Tableau): Check => Repair.step(tab, 0),

	value: (tab: Tableau, variable: string): Delta => tab.assignment.get(variable) ?? Delta.zero,
};

export type Check = Either<Conflict, Tableau>;

export type Bound = {
	readonly value: Delta;
	readonly reason: Literal;
};

export namespace Bound {
	export type Input = {
		readonly value: Rational;
		readonly strict: boolean;
		readonly reason: Literal;
	};

	export type Pair = {
		readonly lower: Bound | undefined;
		readonly upper: Bound | undefined;
	};

	export const Pair = {
		empty: {
			lower: undefined,
			upper: undefined,
		} satisfies Pair,
	};
}

export type Row = ReadonlyMap<string, Rational>;

export type Tableau = {
	readonly rows: ReadonlyMap<string, Row>;
	readonly basic: ReadonlySet<string>;
	readonly assignment: ReadonlyMap<string, Delta>;
	readonly bounds: ReadonlyMap<string, Bound.Pair>;
};

export namespace Event {
	export type T =
		| { readonly tag: "bound"; readonly variable: string; readonly direction: "lower" | "upper"; readonly bound: Bound.Input }
		| { readonly tag: "conflict"; readonly variable: string; readonly lower: Rational; readonly upper: Rational }
		| { readonly tag: "violation"; readonly variable: string; readonly direction: "below" | "above" }
		| { readonly tag: "pivot"; readonly leaving: string; readonly entering: string }
		| { readonly tag: "infeasible"; readonly variable: string }
		| { readonly tag: "feasible" };
}

export type Event = Event.T;

const tighten = (tab: Tableau, variable: string, input: Bound.Input, direction: "lower" | "upper"): Check => {
	const delta = direction === "lower" ? Rational.one : Rational.minusOne;
	const bound: Bound = { value: Delta.of(input.value, input.strict ? delta : Rational.zero), reason: input.reason };
	const current = tab.bounds.get(variable) ?? Bound.Pair.empty;
	const opposite = direction === "lower" ? current.upper : current.lower;
	if (opposite && (direction === "lower" ? Delta.gt(bound.value, opposite.value) : Delta.lt(bound.value, opposite.value))) {
		return E.left(Conflicts.bound(bound.reason, opposite.reason, variable));
	}
	const previous = current[direction];
	if (previous && (direction === "lower" ? Delta.leq(bound.value, previous.value) : Delta.geq(bound.value, previous.value))) {
		return E.right(tab);
	}
	const updated = { ...tab, bounds: new Map([...tab.bounds, [variable, { ...current, [direction]: bound }]]) };
	const value = Simplex.value(tab, variable);
	const violated = direction === "lower" ? Delta.lt(value, bound.value) : Delta.gt(value, bound.value);
	return E.right(violated && !tab.basic.has(variable) ? Assignment.propagate(updated, variable, bound.value) : updated);
};

const Repair = {
	step: (tab: Tableau, n: number): Check => {
		if (n >= MAX_PIVOTS) {
			return E.right(tab);
		}
		const violation = Violation.find(tab);

		if (!violation) {
			return E.right(tab);
		}
		const entering = Candidate.find(tab, violation);

		if (entering === undefined) {
			return E.left(Conflicts.infeasible(tab, violation));
		}
		return Repair.step(Pivot.run(tab, violation, entering), n + 1);
	},
};

const Assignment = {
	propagate: (tab: Tableau, variable: string, value: Delta): Tableau => {
		const shift = Delta.sub(value, tab.assignment.get(variable) ?? Delta.zero);
		const assignment = [...tab.rows.entries()].reduce<ReadonlyMap<string, Delta>>(
			(acc, [bv, row]) => {
				const coeff = row.get(variable);

				if (!coeff || Rational.isZero(coeff)) {
					return acc;
				}
				return new Map([...acc, [bv, Delta.add(acc.get(bv) ?? Delta.zero, Delta.scale(shift, coeff))]]);
			},
			new Map([...tab.assignment, [variable, value]]),
		);
		return { ...tab, assignment };
	},
};

type Violation = {
	readonly variable: string;
	readonly direction: "below" | "above";
	readonly target: Delta;
};

const Violation = {
	find: (tab: Tableau): Violation | undefined =>
		[...tab.basic].reduce<Violation | undefined>((found, variable) => found ?? Violation.variable(tab, variable), undefined),

	variable: (tab: Tableau, variable: string): Violation | undefined => {
		const value = Simplex.value(tab, variable);
		const { lower, upper } = tab.bounds.get(variable) ?? Bound.Pair.empty;

		if (lower && Delta.lt(value, lower.value)) {
			return { variable, direction: "below", target: lower.value };
		}

		if (upper && Delta.gt(value, upper.value)) {
			return { variable, direction: "above", target: upper.value };
		}
		return undefined;
	},
};

const Candidate = {
	find: (tab: Tableau, v: Violation): string | undefined => {
		const row = tab.rows.get(v.variable);
		return row && [...row].find(([nbv, coeff]) => Candidate.viable(tab, v, nbv, coeff))?.[0];
	},

	viable: (tab: Tableau, v: Violation, nbv: string, coeff: Rational): boolean => {
		if (tab.basic.has(nbv) || Rational.isZero(coeff)) {
			return false;
		}
		const value = Simplex.value(tab, nbv);
		const { lower, upper } = tab.bounds.get(nbv) ?? Bound.Pair.empty;
		const increase = !upper || Delta.lt(value, upper.value);
		const decrease = !lower || Delta.gt(value, lower.value);
		return match(v.direction)
			.with("below", () => (Rational.isPositive(coeff) && increase) || (Rational.isNegative(coeff) && decrease))
			.with("above", () => (Rational.isNegative(coeff) && increase) || (Rational.isPositive(coeff) && decrease))
			.exhaustive();
	},
};

const Pivot = {
	run: (tab: Tableau, violation: Violation, entering: string): Tableau => {
		const row = tab.rows.get(violation.variable);
		return row ? Pivot.apply(tab, violation, entering, row) : tab;
	},

	/*
	 * The row `leaving = coeff * entering + rest` is solved as `entering = (leaving - rest) / coeff` and substituted into
	 * the other rows. Moving `leaving` onto its violated bound moves `entering` by `θ = (target - leaving) / coeff`.
	 */
	apply: (tab: Tableau, violation: Violation, entering: string, row: Row): Tableau => {
		const leaving = violation.variable;
		const coeff = row.get(entering) ?? Rational.one;
		const solved = Pivot.solve(row, entering, leaving, Rational.div(Rational.one, coeff));
		return {
			rows: Pivot.rows(tab, leaving, entering, solved),
			basic: new Set([...[...tab.basic].filter(v => v !== leaving), entering]),
			assignment: Pivot.assignment(tab, violation, entering, coeff),
			bounds: tab.bounds,
		};
	},

	solve: (row: Row, entering: string, leaving: string, inv: Rational): Row =>
		[...row.entries()].reduce<Row>(
			(acc, [v, c]) => (v === entering ? acc : new Map([...acc, [v, Rational.mul(Rational.neg(c), inv)]])),
			new Map([[leaving, inv]]),
		),

	rows: (tab: Tableau, leaving: string, entering: string, solved: Row): ReadonlyMap<string, Row> =>
		[...tab.rows.entries()]
			.filter(([bv]) => bv !== leaving)
			.reduce<ReadonlyMap<string, Row>>(
				(acc, [bv, row]) => {
					const coeff = row.get(entering);
					return new Map([...acc, [bv, coeff && !Rational.isZero(coeff) ? Pivot.substitute(row, entering, solved, coeff) : row]]);
				},
				new Map<string, Row>([[entering, solved]]),
			),

	substitute: (row: Row, entering: string, solved: Row, ec: Rational): Row =>
		[...solved.entries()].reduce<Row>(
			(acc, [nv, nc]) => Row.set(acc, nv, Rational.add(acc.get(nv) ?? Rational.zero, Rational.mul(ec, nc))),
			new Map([...row.entries()].filter(([v]) => v !== entering)),
		),

	/* Substitution removes the entering variable from the other rows, so propagation uses the original coefficients. */
	assignment: (tab: Tableau, { variable: leaving, target }: Violation, entering: string, coeff: Rational): ReadonlyMap<string, Delta> => {
		const theta = Delta.scale(Delta.sub(target, Simplex.value(tab, leaving)), Rational.div(Rational.one, coeff));
		return Assignment.propagate(tab, entering, Delta.add(Simplex.value(tab, entering), theta)).assignment;
	},
};

const Row = {
	set: (row: Row, variable: string, value: Rational): Row =>
		Rational.isZero(value) ? new Map([...row.entries()].filter(([v]) => v !== variable)) : new Map([...row, [variable, value]]),
};

const Conflicts = {
	bound: (r1: Literal, r2: Literal, variable: string): Conflict => ({
		clause: { literals: [-r1, -r2], origin: `arith:bound-conflict:${variable}` },
	}),

	infeasible: (tab: Tableau, v: Violation): Conflict => {
		const bp = tab.bounds.get(v.variable) ?? Bound.Pair.empty;
		const row = tab.rows.get(v.variable);
		const rowLiterals = row ? [...row.keys()].flatMap(nbv => Reasons.from(tab.bounds.get(nbv) ?? Bound.Pair.empty)) : [];
		return {
			clause: { literals: [...new Set([...Reasons.from(bp), ...rowLiterals])], origin: `arith:infeasible:${v.variable}` },
		};
	},
};

const Reasons = {
	from: (bp: Bound.Pair): readonly Literal[] => [...(bp.lower ? [-bp.lower.reason] : []), ...(bp.upper ? [-bp.upper.reason] : [])],
};
