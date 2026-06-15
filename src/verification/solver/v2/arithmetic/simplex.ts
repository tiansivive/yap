/* eslint-disable @typescript-eslint/no-namespace */
// Dual simplex: linear arithmetic feasibility via rational-bounded tableau repair.
// LRA = Linear Real Arithmetic; BV = Basic Variable; NBV = Non-Basic Variable.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import * as E from "fp-ts/Either";
import type { Either } from "fp-ts/lib/Either";
import { match, P } from "ts-pattern";
import type { Conflict, Literal } from "../cdcl";
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
		assignment: new Map([...tab.assignment, [name, Rational.zero]]),
		bounds: new Map([...tab.bounds, [name, Bound.Pair.empty]]),
	}),

	row: (tab: Tableau, slack: string, coefficients: Row): Tableau => {
		const value = [...coefficients.entries()].reduce(
			(acc, [v, c]) => Rational.add(acc, Rational.mul(c, tab.assignment.get(v) ?? Rational.zero)),
			Rational.zero,
		);
		return {
			...tab,
			rows: new Map([...tab.rows, [slack, coefficients]]),
			basic: new Set([...tab.basic, slack]),
			assignment: new Map([...tab.assignment, [slack, value]]),
			bounds: new Map([...tab.bounds, [slack, Bound.Pair.empty]]),
		};
	},

	lower: (tab: Tableau, variable: string, bound: Bound): Check => tighten(tab, variable, bound, "lower"),

	upper: (tab: Tableau, variable: string, bound: Bound): Check => tighten(tab, variable, bound, "upper"),

	check: (tab: Tableau): Check => repair(tab),

	value: (tab: Tableau, variable: string): Rational => tab.assignment.get(variable) ?? Rational.zero,
};

export type Check = Either<Conflict, Tableau>;

export type Bound = {
	readonly value: Rational;
	readonly strict: boolean;
	readonly reason: Literal;
};

export namespace Bound {
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

	export const opposite = (pair: Pair, direction: "lower" | "upper"): Bound | undefined => (direction === "lower" ? pair.upper : pair.lower);

	export const existing = (pair: Pair, direction: "lower" | "upper"): Bound | undefined => (direction === "lower" ? pair.lower : pair.upper);

	export const conflict = (bound: Bound, opposite: Bound, direction: "lower" | "upper"): boolean => {
		const [lower, upper] = direction === "lower" ? [bound, opposite] : [opposite, bound];
		return lower.strict || upper.strict ? Rational.geq(lower.value, upper.value) : Rational.gt(lower.value, upper.value);
	};

	export const dominated = (bound: Bound, existing: Bound | undefined, direction: "lower" | "upper"): boolean =>
		match(existing)
			.with(undefined, () => false)
			.otherwise(b =>
				match(direction)
					.with("lower", () => !Rational.gt(bound.value, b.value))
					.with("upper", () => !Rational.lt(bound.value, b.value))
					.exhaustive(),
			);
}

export type Row = ReadonlyMap<string, Rational>;

export type Tableau = {
	readonly rows: ReadonlyMap<string, Row>;
	readonly basic: ReadonlySet<string>;
	readonly assignment: ReadonlyMap<string, Rational>;
	readonly bounds: ReadonlyMap<string, Bound.Pair>;
};

export namespace Event {
	export type T =
		| { readonly tag: "bound"; readonly variable: string; readonly direction: "lower" | "upper"; readonly bound: Bound }
		| { readonly tag: "conflict"; readonly variable: string; readonly lower: Rational; readonly upper: Rational }
		| { readonly tag: "violation"; readonly variable: string; readonly direction: "below" | "above" }
		| { readonly tag: "pivot"; readonly leaving: string; readonly entering: string }
		| { readonly tag: "infeasible"; readonly variable: string }
		| { readonly tag: "feasible" };
}

export type Event = Event.T;

const tighten = (tab: Tableau, variable: string, bound: Bound, direction: "lower" | "upper"): Check => {
	const current = tab.bounds.get(variable) ?? Bound.Pair.empty;
	const opposite = Bound.opposite(current, direction);
	return match(opposite)
		.with(P.nonNullable, other =>
			match(Bound.conflict(bound, other, direction))
				.with(true, () => E.left(Conflicts.bound(bound.reason, other.reason, variable)))
				.with(false, () => Tighten.apply(tab, variable, bound, direction, current))
				.exhaustive(),
		)
		.with(undefined, () => Tighten.apply(tab, variable, bound, direction, current))
		.exhaustive();
};

const repair = (tab: Tableau): Check => Repair.step(tab, 0);

const Tighten = {
	apply: (tab: Tableau, variable: string, bound: Bound, direction: "lower" | "upper", current: Bound.Pair): Check =>
		match(Bound.dominated(bound, Bound.existing(current, direction), direction))
			.with(true, () => E.right(tab))
			.with(false, () => {
				const updated = {
					...tab,
					bounds: new Map([...tab.bounds, [variable, { ...current, [direction]: bound }]]),
				};
				const value = tab.assignment.get(variable) ?? Rational.zero;
				const violated = match(direction)
					.with("lower", () => Rational.lt(value, bound.value))
					.with("upper", () => Rational.gt(value, bound.value))
					.exhaustive();
				return E.right(violated && !tab.basic.has(variable) ? Assignment.propagate(updated, variable, bound.value) : updated);
			})
			.exhaustive(),
};

const Repair = {
	step: (tab: Tableau, n: number): Check =>
		match(n >= MAX_PIVOTS)
			.with(true, () => E.right(tab))
			.with(false, () =>
				match(Violation.find(tab))
					.with(undefined, () => E.right(tab))
					.otherwise(v =>
						match(Candidate.find(tab, v))
							.with(undefined, () => E.left(Conflicts.infeasible(tab, v)))
							.otherwise(entering => Repair.step(Pivot.run(tab, v.variable, entering), n + 1)),
					),
			)
			.exhaustive(),
};

const Assignment = {
	propagate: (tab: Tableau, variable: string, value: Rational): Tableau => {
		const delta = Rational.sub(value, tab.assignment.get(variable) ?? Rational.zero);
		const assignment = [...tab.rows.entries()].reduce<ReadonlyMap<string, Rational>>(
			(acc, [bv, row]) =>
				match(row.get(variable))
					.with(P.nonNullable, c =>
						match(Rational.isZero(c))
							.with(true, () => acc)
							.with(false, () => new Map([...acc, [bv, Rational.add(acc.get(bv) ?? Rational.zero, Rational.mul(c, delta))]]))
							.exhaustive(),
					)
					.with(undefined, () => acc)
					.exhaustive(),
			new Map([...tab.assignment, [variable, value]]),
		);
		return { ...tab, assignment };
	},
};

type Violation = {
	readonly variable: string;
	readonly direction: "below" | "above";
};

const Violation = {
	find: (tab: Tableau): Violation | undefined =>
		[...tab.basic].reduce<Violation | undefined>((found, variable) => found ?? Violation.variable(tab, variable), undefined),

	variable: (tab: Tableau, variable: string): Violation | undefined => {
		const value = tab.assignment.get(variable) ?? Rational.zero;
		const bp = tab.bounds.get(variable);
		return match(bp?.lower)
			.with(P.nonNullable, lower =>
				(lower.strict ? Rational.leq(value, lower.value) : Rational.lt(value, lower.value)) ? { variable, direction: "below" as const } : undefined,
			)
			.with(undefined, () =>
				match(bp?.upper)
					.with(P.nonNullable, upper =>
						(upper.strict ? Rational.geq(value, upper.value) : Rational.gt(value, upper.value)) ? { variable, direction: "above" as const } : undefined,
					)
					.with(undefined, () => undefined)
					.exhaustive(),
			)
			.exhaustive();
	},
};

const Candidate = {
	find: (tab: Tableau, v: Violation): string | undefined =>
		match(tab.rows.get(v.variable))
			.with(undefined, () => undefined)
			.otherwise(row =>
				[...row.entries()].reduce<string | undefined>((found, [nbv, coeff]) => found ?? (Candidate.viable(tab, v, nbv, coeff) ? nbv : undefined), undefined),
			),

	viable: (tab: Tableau, v: Violation, nbv: string, coeff: Rational): boolean =>
		match([tab.basic.has(nbv), Rational.isZero(coeff)])
			.with([true, P._], () => false)
			.with([P._, true], () => false)
			.otherwise(() => {
				const value = tab.assignment.get(nbv) ?? Rational.zero;
				const bp = tab.bounds.get(nbv) ?? Bound.Pair.empty;
				return match(v.direction)
					.with(
						"below",
						() =>
							(Rational.isPositive(coeff) && (!bp.upper || Rational.lt(value, bp.upper.value))) ||
							(Rational.isNegative(coeff) && (!bp.lower || Rational.gt(value, bp.lower.value))),
					)
					.with(
						"above",
						() =>
							(Rational.isNegative(coeff) && (!bp.upper || Rational.lt(value, bp.upper.value))) ||
							(Rational.isPositive(coeff) && (!bp.lower || Rational.gt(value, bp.lower.value))),
					)
					.exhaustive();
			}),
};

const Pivot = {
	run: (tab: Tableau, leaving: string, entering: string): Tableau =>
		match(tab.rows.get(leaving))
			.with(undefined, () => tab)
			.otherwise(row => Pivot.apply(tab, leaving, entering, row)),

	apply: (tab: Tableau, leaving: string, entering: string, row: Row): Tableau => {
		const coeff = row.get(entering) ?? Rational.one;
		const inv = Rational.div(Rational.minusOne, coeff);
		const solved = Pivot.solve(row, entering, leaving, inv);
		const rows = Pivot.rows(tab, leaving, entering, solved);
		const assignment = Pivot.assignment(tab, rows, leaving, entering, coeff);
		return {
			rows,
			basic: new Set([...[...tab.basic].filter(v => v !== leaving), entering]),
			assignment,
			bounds: tab.bounds,
		};
	},

	solve: (row: Row, entering: string, leaving: string, inv: Rational): Row =>
		[...row.entries()].reduce<Row>(
			(acc, [v, c]) =>
				match(v === entering)
					.with(true, () => acc)
					.with(false, () => new Map([...acc, [v, Rational.mul(Rational.neg(c), inv)]]))
					.exhaustive(),
			new Map([[leaving, inv]]),
		),

	rows: (tab: Tableau, leaving: string, entering: string, solved: Row): ReadonlyMap<string, Row> =>
		[...tab.rows.entries()]
			.filter(([bv]) => bv !== leaving)
			.reduce<ReadonlyMap<string, Row>>(
				(acc, [bv, row]) =>
					match(row.get(entering))
						.with(P.nonNullable, ec => new Map([...acc, [bv, Rational.isZero(ec) ? row : Pivot.substitute(row, entering, solved, ec)]]))
						.with(undefined, () => new Map([...acc, [bv, row]]))
						.exhaustive(),
				new Map<string, Row>([[entering, solved]]),
			),

	substitute: (row: Row, entering: string, solved: Row, ec: Rational): Row =>
		[...solved.entries()].reduce<Row>(
			(acc, [nv, nc]) => Row.set(acc, nv, Rational.add(acc.get(nv) ?? Rational.zero, Rational.mul(ec, nc))),
			new Map([...row.entries()].filter(([v]) => v !== entering)),
		),

	assignment: (tab: Tableau, rows: ReadonlyMap<string, Row>, leaving: string, entering: string, coeff: Rational): ReadonlyMap<string, Rational> => {
		const lv = tab.assignment.get(leaving) ?? Rational.zero;
		const bp = tab.bounds.get(leaving) ?? Bound.Pair.empty;
		const target = bp.lower && Rational.lt(lv, bp.lower.value) ? bp.lower.value : bp.upper && Rational.gt(lv, bp.upper.value) ? bp.upper.value : lv;
		const delta = Rational.div(Rational.sub(target, lv), coeff);
		return [...rows.entries()].reduce<ReadonlyMap<string, Rational>>(
			(acc, [bv, row]) =>
				match([bv === entering, row.get(entering)])
					.with([true, P._], () => acc)
					.with([false, P.nonNullable], ([, ec]) => new Map([...acc, [bv, Rational.add(acc.get(bv) ?? Rational.zero, Rational.mul(ec, delta))]]))
					.otherwise(() => acc),
			new Map([...tab.assignment, [entering, Rational.add(tab.assignment.get(entering) ?? Rational.zero, delta)], [leaving, target]]),
		);
	},
};

const Row = {
	set: (row: Row, variable: string, value: Rational): Row =>
		match(Rational.isZero(value))
			.with(true, () => new Map([...row.entries()].filter(([v]) => v !== variable)))
			.with(false, () => new Map([...row, [variable, value]]))
			.exhaustive(),
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
