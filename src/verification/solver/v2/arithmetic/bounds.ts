// Arithmetic bound registration: maps Boolean literals to simplex bound assertions.
// LIA = Linear Integer Arithmetic; LRA = Linear Real Arithmetic.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import * as E from "fp-ts/Either";
import { match } from "ts-pattern";
import type { Conflict, Literal } from "../cdcl";
import type { Constraint, Linear } from "./normalize";
import { Rational } from "./rational";
import { Bound, Simplex, type Tableau } from "./simplex";

const Patterns = {
	Leq: { tag: "leq" } as const,
	Lt: { tag: "lt" } as const,
	Eq: { tag: "eq" } as const,
	Neq: { tag: "neq" } as const,
};

const SIGN = {
	Positive: 1,
	Negative: -1,
} as const;

export const Bounds = {
	Sign: SIGN,

	empty: new Map() satisfies Bounds.Map,

	slack: (literal: Literal): string => `$slack_${Math.abs(literal)}`,

	register: (map: Bounds.Map, literal: Literal, constraint: Constraint, sign: Bounds.Sign = SIGN.Positive): Bounds.Map =>
		new Map([...map, [literal, Bounds.from(literal, constraint, sign)]]),

	assert: (tableau: Tableau, map: Bounds.Map, literal: Literal): E.Either<Conflict, Tableau> =>
		(map.get(literal) ?? []).reduce<E.Either<Conflict, Tableau>>(
			(acc, { kind, variable, value, strict }) => E.Monad.chain(acc, tab => Simplex[kind](tab, variable, { value, strict, reason: literal })),
			E.right(tableau),
		),

	from: (literal: Literal, constraint: Constraint, sign: Bounds.Sign = SIGN.Positive): Bounds.Registration[] =>
		match(constraint)
			.with(Patterns.Leq, ({ expr }) => BoundExpression.from(literal, expr, Bound.Orientation.Upper, false, sign))
			.with(Patterns.Lt, ({ expr }) => BoundExpression.from(literal, expr, Bound.Orientation.Upper, true, sign))
			.with(Patterns.Eq, ({ expr }) => [
				...BoundExpression.from(literal, expr, Bound.Orientation.Lower, false, sign),
				...BoundExpression.from(literal, expr, Bound.Orientation.Upper, false, sign),
			])
			.with(Patterns.Neq, () => [])
			.exhaustive(),
};

export namespace Bounds {
	export type Sign = (typeof SIGN)[keyof typeof SIGN];

	export type Registration = {
		readonly variable: string;
		readonly kind: Bound.Orientation;
		readonly value: Rational;
		readonly strict: boolean;
	};

	export type Map = ReadonlyMap<Literal, readonly Registration[]>;
}

const BoundExpression = {
	from: (literal: Literal, expr: Linear.Expr, kind: Bound.Orientation, strict: boolean, sign: Bounds.Sign): Bounds.Registration[] => {
		if (expr.coefficients.size === 1) {
			const [name, coeff] = [...expr.coefficients][0];
			return BoundExpression.scaled(name, coeff, expr.constant, kind, strict);
		}
		const scale = expr.coefficients.size === 0 ? Rational.one : Rational.from(sign);
		return BoundExpression.scaled(Bounds.slack(literal), scale, expr.constant, kind, strict);
	},

	scaled: (variable: string, coeff: Rational, constant: Rational, kind: Bound.Orientation, strict: boolean): Bounds.Registration[] => [
		{
			variable,
			kind: Rational.isNegative(coeff) ? BoundExpression.flip(kind) : kind,
			value: Rational.div(Rational.neg(constant), coeff),
			strict,
		},
	],

	flip: (kind: Bound.Orientation): Bound.Orientation => (kind === Bound.Orientation.Lower ? Bound.Orientation.Upper : Bound.Orientation.Lower),
};
