// Dual simplex: linear arithmetic feasibility via rational-bounded tableau pivoting.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md
// LRA = Linear Real Arithmetic, BV = Basic Variable, NBV = Non-Basic Variable

import * as E from "fp-ts/Either";
import { match } from "ts-pattern";
import { Rational } from "./rational";
import type { Literal, Conflict } from "../../cdcl/core";
import { ArithTrace } from "../theory";

const THEORY_CLAUSE_ID = -2;

export type Bound = {
	readonly value: Rational;
	readonly strict: boolean;
	readonly reason: Literal;
};

export type BoundPair = {
	readonly lower: Bound | undefined;
	readonly upper: Bound | undefined;
};

export type Row = ReadonlyMap<string, Rational>;

export type Tableau = {
	readonly rows: ReadonlyMap<string, Row>;
	readonly basic: ReadonlySet<string>;
	readonly assignment: ReadonlyMap<string, Rational>;
	readonly bounds: ReadonlyMap<string, BoundPair>;
};

// === Public API ===

export const Simplex = {
	create: (): Tableau => ({
		rows: new Map(),
		basic: new Set(),
		assignment: new Map(),
		bounds: new Map(),
	}),

	Variable: {
		add: (tab: Tableau, name: string): Tableau => ({
			...tab,
			assignment: new Map([...tab.assignment, [name, Rational.zero]]),
			bounds: new Map([...tab.bounds, [name, { lower: undefined, upper: undefined }]]),
		}),
	},

	Row: {
		add: (tab: Tableau, slack: string, coefficients: Row): Tableau => {
			const value = [...coefficients.entries()].reduce(
				(acc, [v, c]) => Rational.add(acc, Rational.mul(c, tab.assignment.get(v) ?? Rational.zero)),
				Rational.zero,
			);
			return {
				...tab,
				rows: new Map([...tab.rows, [slack, coefficients]]),
				basic: new Set([...tab.basic, slack]),
				assignment: new Map([...tab.assignment, [slack, value]]),
				bounds: new Map([...tab.bounds, [slack, { lower: undefined, upper: undefined }]]),
			};
		},
	},

	Assert: {
		lower: (tab: Tableau, variable: string, bound: Bound): E.Either<Conflict, Tableau> => tighten(tab, variable, bound, "lower"),
		upper: (tab: Tableau, variable: string, bound: Bound): E.Either<Conflict, Tableau> => tighten(tab, variable, bound, "upper"),
	},

	check: (tab: Tableau): E.Either<Conflict, Tableau> => repair(tab),

	Trace: {
		check: function* (tab: Tableau): Generator<ArithTrace.Step, E.Either<Conflict, Tableau>> {
			return yield* traced(tab);
		},
	},

	value: (tab: Tableau, variable: string): Rational => tab.assignment.get(variable) ?? Rational.zero,
};

// === Assert helpers ===

const tighten = (tab: Tableau, variable: string, bound: Bound, dir: "lower" | "upper"): E.Either<Conflict, Tableau> => {
	const current = tab.bounds.get(variable) ?? { lower: undefined, upper: undefined };
	const opposite = dir === "lower" ? current.upper : current.lower;

	if (opposite && conflicting(bound, opposite, dir)) {
		return E.left(Conflicts.bound(bound.reason, opposite.reason, variable));
	}

	const existing = dir === "lower" ? current.lower : current.upper;
	const dominated = match(dir)
		.with("lower", () => existing && !Rational.gt(bound.value, existing.value))
		.with("upper", () => existing && !Rational.lt(bound.value, existing.value))
		.exhaustive();

	if (dominated) {
		return E.right(tab);
	}

	const updated: Tableau = {
		...tab,
		bounds: new Map([...tab.bounds, [variable, { ...current, [dir]: bound }]]),
	};

	const value = tab.assignment.get(variable) ?? Rational.zero;
	const violated = match(dir)
		.with("lower", () => Rational.lt(value, bound.value))
		.with("upper", () => Rational.gt(value, bound.value))
		.exhaustive();

	return E.right(violated && !tab.basic.has(variable) ? propagate(updated, variable, bound.value) : updated);
};

const conflicting = (bound: Bound, opposite: Bound, dir: "lower" | "upper"): boolean => {
	const [lower, upper] = dir === "lower" ? [bound, opposite] : [opposite, bound];
	return lower.strict || upper.strict ? Rational.geq(lower.value, upper.value) : Rational.gt(lower.value, upper.value);
};

const propagate = (tab: Tableau, variable: string, value: Rational): Tableau => {
	const delta = Rational.sub(value, tab.assignment.get(variable) ?? Rational.zero);
	const assignment = [...tab.rows.entries()].reduce(
		(acc, [bv, row]) => {
			const c = row.get(variable);

			if (c && !Rational.isZero(c)) {
				acc.set(bv, Rational.add(acc.get(bv) ?? Rational.zero, Rational.mul(c, delta)));
			}
			return acc;
		},
		new Map([...tab.assignment, [variable, value]]),
	);
	return { ...tab, assignment };
};

// === Check helpers ===

const MAX_PIVOTS = 100;

const repair = (tab: Tableau): E.Either<Conflict, Tableau> => {
	const step = (current: Tableau, n: number): E.Either<Conflict, Tableau> => {
		if (n >= MAX_PIVOTS) {
			return E.right(current);
		}
		const v = violation(current);

		if (!v) {
			return E.right(current);
		}
		const entering = candidate(current, v);

		if (!entering) {
			return E.left(Conflicts.infeasible(current, v));
		}
		return step(pivot(current, v.variable, entering), n + 1);
	};
	return step(tab, 0);
};

const traced = function* (tab: Tableau): Generator<ArithTrace.Step, E.Either<Conflict, Tableau>> {
	const step = function* (current: Tableau, n: number): Generator<ArithTrace.Step, E.Either<Conflict, Tableau>> {
		if (n >= MAX_PIVOTS) {
			yield { tag: "feasible" } satisfies ArithTrace.Step;
			return E.right(current);
		}
		const v = violation(current);
		if (!v) {
			yield { tag: "feasible" } satisfies ArithTrace.Step;
			return E.right(current);
		}
		const value = current.assignment.get(v.variable) ?? Rational.zero;
		yield { tag: "violation", variable: v.variable, value, direction: v.direction } satisfies ArithTrace.Step;
		const entering = candidate(current, v);
		if (!entering) {
			yield { tag: "infeasible", variable: v.variable } satisfies ArithTrace.Step;
			return E.left(Conflicts.infeasible(current, v));
		}
		yield { tag: "pivot", leaving: v.variable, entering } satisfies ArithTrace.Step;
		return yield* step(pivot(current, v.variable, entering), n + 1);
	};
	return yield* step(tab, 0);
};

// === Repair helpers ===

type Violation = {
	readonly variable: string;
	readonly direction: "below" | "above";
};

const violation = (tab: Tableau): Violation | undefined => {
	const check = (v: string): Violation | undefined => {
		const value = tab.assignment.get(v) ?? Rational.zero;
		const bp = tab.bounds.get(v);

		if (bp?.lower && (bp.lower.strict ? Rational.leq(value, bp.lower.value) : Rational.lt(value, bp.lower.value))) {
			return { variable: v, direction: "below" };
		}

		if (bp?.upper && (bp.upper.strict ? Rational.geq(value, bp.upper.value) : Rational.gt(value, bp.upper.value))) {
			return { variable: v, direction: "above" };
		}
		return undefined;
	};
	return [...tab.basic].reduce<Violation | undefined>((found, v) => found ?? check(v), undefined);
};

const candidate = (tab: Tableau, v: Violation): string | undefined => {
	const row = tab.rows.get(v.variable);

	if (!row) {
		return undefined;
	}
	const viable = (nbv: string, coeff: Rational): boolean => {
		if (tab.basic.has(nbv) || Rational.isZero(coeff)) {
			return false;
		}
		const value = tab.assignment.get(nbv) ?? Rational.zero;
		const bp = tab.bounds.get(nbv) ?? { lower: undefined, upper: undefined };
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
	};
	return [...row.entries()].reduce<string | undefined>((found, [nbv, coeff]) => found ?? (viable(nbv, coeff) ? nbv : undefined), undefined);
};

const pivot = (tab: Tableau, leaving: string, entering: string): Tableau => {
	const row = tab.rows.get(leaving);

	if (!row) {
		return tab;
	}

	const coeff = row.get(entering) ?? Rational.one;
	const inv = Rational.div(Rational.minusOne, coeff);

	const solved = [...row.entries()].reduce(
		(acc, [v, c]) => {
			if (v !== entering) {
				acc.set(v, Rational.mul(Rational.neg(c), inv));
			}
			return acc;
		},
		new Map([[leaving, inv]]),
	);

	const substitute = (r: Row, ec: Rational): Map<string, Rational> =>
		[...solved.entries()].reduce(
			(acc, [nv, nc]) => {
				const combined = Rational.add(acc.get(nv) ?? Rational.zero, Rational.mul(ec, nc));
				Rational.isZero(combined) ? acc.delete(nv) : acc.set(nv, combined);
				return acc;
			},
			new Map([...r.entries()].filter(([v]) => v !== entering)),
		);

	const rows = [...tab.rows.entries()]
		.filter(([bv]) => bv !== leaving)
		.reduce(
			(acc, [bv, r]) => {
				const ec = r.get(entering);
				acc.set(bv, ec && !Rational.isZero(ec) ? substitute(r, ec) : r);
				return acc;
			},
			new Map<string, Row>([[entering, solved]]),
		);

	const lv = tab.assignment.get(leaving) ?? Rational.zero;
	const bp = tab.bounds.get(leaving) ?? { lower: undefined, upper: undefined };
	const target = bp.lower && Rational.lt(lv, bp.lower.value) ? bp.lower.value : bp.upper && Rational.gt(lv, bp.upper.value) ? bp.upper.value : lv;
	const delta = Rational.div(Rational.sub(target, lv), coeff);

	const assignment = [...rows.entries()].reduce(
		(acc, [bv, r]) => {
			if (bv === entering) {
				return acc;
			}
			const ec = r.get(entering);

			if (ec) {
				acc.set(bv, Rational.add(acc.get(bv) ?? Rational.zero, Rational.mul(ec, delta)));
			}
			return acc;
		},
		new Map([...tab.assignment, [entering, Rational.add(tab.assignment.get(entering) ?? Rational.zero, delta)], [leaving, target]]),
	);

	const basic = new Set([...[...tab.basic].filter(v => v !== leaving), entering]);

	return { rows, basic, assignment, bounds: tab.bounds };
};

// === Conflict helpers ===

const Conflicts = {
	bound: (r1: Literal, r2: Literal, variable: string): Conflict => ({
		clause: { id: THEORY_CLAUSE_ID, literals: [-r1, -r2], origin: `arith:bound-conflict:${variable}` },
	}),

	infeasible: (tab: Tableau, v: Violation): Conflict => {
		const bp = tab.bounds.get(v.variable) ?? { lower: undefined, upper: undefined };
		const row = tab.rows.get(v.variable);
		const rowLiterals = row ? [...row.keys()].flatMap(nbv => reasons(tab.bounds.get(nbv) ?? { lower: undefined, upper: undefined })) : [];
		return {
			clause: { id: THEORY_CLAUSE_ID, literals: [...new Set([...reasons(bp), ...rowLiterals])], origin: `arith:infeasible:${v.variable}` },
		};
	},
};

const reasons = (bp: BoundPair): readonly Literal[] => [...(bp.lower ? [-bp.lower.reason] : []), ...(bp.upper ? [-bp.upper.reason] : [])];
