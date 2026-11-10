// Arithmetic bound registration: maps Boolean literals to simplex bound assertions.
// LIA = Linear Integer Arithmetic; LRA = Linear Real Arithmetic.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import * as E from "fp-ts/Either";
import { match } from "ts-pattern";
import type { Conflict, Literal } from "../cdcl";
import type { Constraint, Linear } from "./normalize";
import { Rational } from "./rational";
import { Simplex, type Bound as SimplexBound, type Tableau } from "./simplex";

const Patterns = {
	Leq: { tag: "leq" } as const,
	Lt: { tag: "lt" } as const,
	Eq: { tag: "eq" } as const,
	Neq: { tag: "neq" } as const,
};

export const Bounds = {
	empty: new Map() satisfies Bounds.Map,

	slack: (literal: Literal): string => `$slack_${Math.abs(literal)}`,

	register: (map: Bounds.Map, literal: Literal, constraint: Constraint, row: ReadonlyMap<string, Rational>): Bounds.Map =>
		new Map([...map, [literal, Bounds.from(literal, constraint, row)]]),

	assert: (tableau: Tableau, map: Bounds.Map, literal: Literal): E.Either<Conflict, Tableau> =>
		(map.get(literal) ?? []).reduce<E.Either<Conflict, Tableau>>(
			(acc, bound) =>
				E.Monad.chain(acc, tab =>
					match(bound.kind)
						.with("lower", () => Simplex.lower(tab, bound.variable, BoundValue.of(bound, literal)))
						.with("upper", () => Simplex.upper(tab, bound.variable, BoundValue.of(bound, literal)))
						.exhaustive(),
				),
			E.right(tableau),
		),

	from: (literal: Literal, constraint: Constraint, row: ReadonlyMap<string, Rational>): Bounds.Registration[] =>
		match(constraint)
			.with(Patterns.Leq, ({ expr }) => BoundExpression.from(literal, expr, "upper", false, row))
			.with(Patterns.Lt, ({ expr }) => BoundExpression.from(literal, expr, "upper", true, row))
			.with(Patterns.Eq, ({ expr }) => [
				...BoundExpression.from(literal, expr, "lower", false, row),
				...BoundExpression.from(literal, expr, "upper", false, row),
			])
			.with(Patterns.Neq, () => [])
			.exhaustive(),
};

export namespace Bounds {
	export type Registration = {
		readonly variable: string;
		readonly kind: "lower" | "upper";
		readonly value: Rational;
		readonly strict: boolean;
	};

	export type Map = ReadonlyMap<Literal, readonly Registration[]>;
}

const BoundExpression = {
	from: (literal: Literal, expr: Linear.Expr, kind: "lower" | "upper", strict: boolean, row: ReadonlyMap<string, Rational>): Bounds.Registration[] =>
		match(expr.coefficients.size)
			.with(1, () => BoundExpression.single(expr, kind, strict))
			.otherwise(() => BoundExpression.slack(literal, expr, kind, strict, row)),

	single: (expr: Linear.Expr, kind: "lower" | "upper", strict: boolean): Bounds.Registration[] => {
		const [name, coeff] = [...expr.coefficients.entries()][0];
		return BoundExpression.scaled(name, coeff, expr.constant, kind, strict);
	},

	/*
	 * A literal and its negation bound the same slack row, the one built from the atom. The negation's expression is a
	 * multiple of that row, so `¬(x - y <= 0)`, normalized to `y - x < 0`, bounds the row `x - y` from below.
	 */
	slack: (literal: Literal, expr: Linear.Expr, kind: "lower" | "upper", strict: boolean, row: ReadonlyMap<string, Rational>): Bounds.Registration[] => {
		const scale = match([...expr.coefficients.entries()].at(0))
			.with(undefined, () => Rational.one)
			.otherwise(([name, coeff]) =>
				match(row.get(name))
					.with(undefined, () => {
						throw new Error(`Slack row for literal ${literal} has no coefficient for ${name}`);
					})
					.otherwise(base => Rational.div(coeff, base)),
			);
		return BoundExpression.scaled(Bounds.slack(literal), scale, expr.constant, kind, strict);
	},

	scaled: (variable: string, coeff: Rational, constant: Rational, kind: "lower" | "upper", strict: boolean): Bounds.Registration[] => [
		{
			variable,
			kind: Rational.isNegative(coeff) ? BoundExpression.flip(kind) : kind,
			value: Rational.div(Rational.neg(constant), coeff),
			strict,
		},
	],

	flip: (kind: "lower" | "upper"): "lower" | "upper" =>
		match(kind)
			.with("lower", () => "upper" as const)
			.with("upper", () => "lower" as const)
			.exhaustive(),
};

const BoundValue = {
	of: (registration: Bounds.Registration, literal: Literal): SimplexBound => ({
		value: registration.value,
		strict: registration.strict,
		reason: literal,
	}),
};
