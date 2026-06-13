// Arithmetic bound registration: maps Boolean literals to simplex bound assertions.
// LIA = Linear Integer Arithmetic; LRA = Linear Real Arithmetic.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import * as E from "fp-ts/Either";
import { match } from "ts-pattern";
import type { Conflict, Literal } from "../cdcl";
import type { Constraint, Linear } from "./normalize";
import { Rational } from "./rational";
import { Simplex, type Bound as SimplexBound, type Tableau } from "./simplex";

export const Bounds = {
	empty: new Map() satisfies Bounds.Map,

	register: (map: Bounds.Map, literal: Literal, constraint: Constraint): Bounds.Map => new Map([...map, [literal, Bounds.from(literal, constraint)]]),

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

	from: (literal: Literal, constraint: Constraint): Bounds.Registration[] =>
		match(constraint)
			.with({ tag: "leq" }, ({ expr }) => BoundExpression.from(literal, expr, "upper", false))
			.with({ tag: "lt" }, ({ expr }) => BoundExpression.from(literal, expr, "upper", true))
			.with({ tag: "eq" }, ({ expr }) => [...BoundExpression.from(literal, expr, "lower", false), ...BoundExpression.from(literal, expr, "upper", false)])
			.with({ tag: "neq" }, () => [])
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
	from: (literal: Literal, expr: Linear.Expr, kind: "lower" | "upper", strict: boolean): Bounds.Registration[] =>
		match(expr.coefficients.size)
			.with(1, () => BoundExpression.single(expr, kind, strict))
			.otherwise(() => BoundExpression.slack(literal, expr, kind, strict)),

	single: (expr: Linear.Expr, kind: "lower" | "upper", strict: boolean): Bounds.Registration[] => {
		const [name, coeff] = [...expr.coefficients.entries()][0];
		const rhs = Rational.neg(expr.constant);
		const value = Rational.div(rhs, coeff);
		const effective = Rational.isNegative(coeff) ? BoundExpression.flip(kind) : kind;
		return [{ variable: name, kind: effective, value, strict }];
	},

	slack: (literal: Literal, expr: Linear.Expr, kind: "lower" | "upper", strict: boolean): Bounds.Registration[] => [
		{ variable: `$slack_${literal}`, kind, value: Rational.neg(expr.constant), strict },
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
