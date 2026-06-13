/* eslint-disable @typescript-eslint/no-namespace */
// Arithmetic v2 domain model: linear constraints and solver-owned tableau state.
// LIA/LRA = Linear Integer/Real Arithmetic.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import { match, P } from "ts-pattern";
import type { IVL } from "../ivl/types";
import type { Literal } from "./cdcl";

export type Rational = {
	num: bigint;
	den: bigint;
};

export namespace Linear {
	export type Expr = {
		coefficients: Map<string, Rational>;
		constant: Rational;
	};
}

export type Constraint =
	| { tag: "le"; expr: Linear.Expr }
	| { tag: "lt"; expr: Linear.Expr }
	| { tag: "eq"; expr: Linear.Expr }
	| { tag: "neq"; expr: Linear.Expr };

export namespace Constraint {
	export type Info = {
		constraint: Constraint;
		sort: IVL.NumSort;
	};
}

export type Bound = {
	variable: string;
	value: Rational;
	strict: boolean;
	reason: Literal;
};

export type Tableau = {
	rows: Map<string, Linear.Expr>;
	assignment: Map<string, Rational>;
};

export type Snapshot = {
	tableau: Tableau;
	bounds: Map<string, Bound[]>;
};

export type State = {
	tableau: Tableau;
	bounds: Map<string, Bound[]>;
	integerVars: Set<string>;
	constraints: Map<Literal, Constraint.Info>;
	stack: Snapshot[];
};

export const Rational = {
	zero: { num: 0n, den: 1n } satisfies Rational,
	one: { num: 1n, den: 1n } satisfies Rational,
};

export const Tableau = {
	empty: {
		rows: new Map(),
		assignment: new Map(),
	} satisfies Tableau,
};

export const State = {
	empty: {
		tableau: Tableau.empty,
		bounds: new Map(),
		integerVars: new Set(),
		constraints: new Map(),
		stack: [],
	} satisfies State,

	push: (state: State): State => ({
		...state,
		stack: [...state.stack, { tableau: state.tableau, bounds: state.bounds }],
	}),

	pop: (state: State): State =>
		match(state.stack[state.stack.length - 1])
			.with(P.nullish, () => state)
			.otherwise(snapshot => ({
				...state,
				tableau: snapshot.tableau,
				bounds: snapshot.bounds,
				stack: state.stack.slice(0, -1),
			})),
};

export namespace Event {
	export type T =
		| { tag: "bound"; variable: string; bound: Bound }
		| { tag: "conflict"; variable: string; lower: Rational; upper: Rational }
		| { tag: "violation"; variable: string; direction: "below" | "above" }
		| { tag: "pivot"; leaving: string; entering: string }
		| { tag: "infeasible"; variable: string }
		| { tag: "feasible" };
}
