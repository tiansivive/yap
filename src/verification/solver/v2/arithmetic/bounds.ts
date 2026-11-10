// Arithmetic bound registration: maps Boolean literals to simplex bound assertions.
// LIA = Linear Integer Arithmetic; LRA = Linear Real Arithmetic.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import * as E from "fp-ts/Either";
import { match } from "ts-pattern";
import type { Conflict, Literal } from "../cdcl";
import type { Constraint, Linear } from "./normalize";
import { Rational } from "./rational";
import { Simplex, type Tableau } from "./simplex";

const Patterns = {
	Leq: { tag: "leq" } as const,
	Lt: { tag: "lt" } as const,
	Eq: { tag: "eq" } as const,
	Neq: { tag: "neq" } as const,
};

export const Bounds = {
	empty: new Map() satisfies Bounds.Map,

	slack: (literal: Literal): string => `$slack_${Math.abs(literal)}`,

	register: (map: Bounds.Map, literal: Literal, constraint: Constraint, orientation: 1 | -1 = 1): Bounds.Map =>
		new Map([...map, [literal, Bounds.from(literal, constraint, orientation)]]),

	assert: (tableau: Tableau, map: Bounds.Map, literal: Literal): E.Either<Conflict, Tableau> =>
		(map.get(literal) ?? []).reduce<E.Either<Conflict, Tableau>>(
			(acc, { kind, variable, value, strict }) => E.Monad.chain(acc, tab => Simplex[kind](tab, variable, { value, strict, reason: literal })),
			E.right(tableau),
		),

	from: (literal: Literal, constraint: Constraint, orientation: 1 | -1 = 1): Bounds.Registration[] =>
		match(constraint)
			.with(Patterns.Leq, ({ expr }) => BoundExpression.from(literal, expr, "upper", false, orientation))
			.with(Patterns.Lt, ({ expr }) => BoundExpression.from(literal, expr, "upper", true, orientation))
			.with(Patterns.Eq, ({ expr }) => [
				...BoundExpression.from(literal, expr, "lower", false, orientation),
				...BoundExpression.from(literal, expr, "upper", false, orientation),
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
	from: (literal: Literal, expr: Linear.Expr, kind: "lower" | "upper", strict: boolean, orientation: 1 | -1): Bounds.Registration[] => {
		if (expr.coefficients.size === 1) {
			const [name, coeff] = [...expr.coefficients][0];
			return BoundExpression.scaled(name, coeff, expr.constant, kind, strict);
		}
		const scale = expr.coefficients.size === 0 ? Rational.one : Rational.from(orientation);
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

	flip: (kind: "lower" | "upper"): "lower" | "upper" => (kind === "lower" ? "upper" : "lower"),
};
