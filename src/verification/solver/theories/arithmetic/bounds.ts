// Bound registration: maps CDCL literals to simplex bound assertions.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import * as E from "fp-ts/Either";
import { pipe } from "fp-ts/function";
import { match } from "ts-pattern";
import type { Literal, Conflict } from "../../cdcl/core";
import type { Tableau, Bound } from "./simplex";
import { Simplex } from "./simplex";
import { Rational } from "./rational";
import type { LinearConstraint } from "./normalize";

export type BoundRegistration = {
	readonly variable: string;
	readonly kind: "lower" | "upper";
	readonly value: Rational;
	readonly strict: boolean;
};

export type BoundMap = ReadonlyMap<Literal, readonly BoundRegistration[]>;

export const Bounds = {
	register: (map: BoundMap, literal: Literal, constraint: LinearConstraint): BoundMap => {
		const registrations = constraintToBounds(literal, constraint);
		const updated = new Map(map);
		updated.set(literal, registrations);
		return updated;
	},

	assert: (tab: Tableau, map: BoundMap, literal: Literal): E.Either<Conflict, Tableau> => {
		const registrations = map.get(literal);

		if (!registrations) {
			return E.right(tab);
		}

		return registrations.reduce<E.Either<Conflict, Tableau>>(
			(acc, reg) =>
				pipe(
					acc,
					E.chain(current => {
						const bound: Bound = { value: reg.value, strict: reg.strict, reason: literal };
						return match(reg.kind)
							.with("lower", () => Simplex.assertLower(current, reg.variable, bound))
							.with("upper", () => Simplex.assertUpper(current, reg.variable, bound))
							.exhaustive();
					}),
				),
			E.right(tab),
		);
	},
};

// Single-variable constraints become direct bounds.
// Multi-variable constraints introduce a slack variable with the constraint as its row.
const constraintToBounds = (literal: Literal, constraint: LinearConstraint): readonly BoundRegistration[] =>
	match(constraint)
		.with({ tag: "leq" }, ({ expr }) => (expr.coefficients.size === 1 ? singleVarBound(expr, "upper", false) : slackBound(literal, expr, "upper", false)))
		.with({ tag: "lt" }, ({ expr }) => (expr.coefficients.size === 1 ? singleVarBound(expr, "upper", true) : slackBound(literal, expr, "upper", true)))
		.with({ tag: "eq" }, ({ expr }) =>
			expr.coefficients.size === 1
				? [...singleVarBound(expr, "lower", false), ...singleVarBound(expr, "upper", false)]
				: [...slackBound(literal, expr, "lower", false), ...slackBound(literal, expr, "upper", false)],
		)
		.with({ tag: "neq" }, () => [])
		.exhaustive();

const singleVarBound = (expr: LinearExpr, kind: "lower" | "upper", strict: boolean): BoundRegistration[] => {
	const [name, coeff] = [...expr.coefficients.entries()][0];
	const rhs = Rational.neg(expr.constant);
	const value = Rational.div(rhs, coeff);

	// If coefficient is negative, flip the bound direction
	const effectiveKind = Rational.isNegative(coeff) ? (kind === "lower" ? "upper" : "lower") : kind;

	return [{ variable: name, kind: effectiveKind, value, strict }];
};

const slackBound = (literal: Literal, expr: LinearExpr, kind: "lower" | "upper", strict: boolean): BoundRegistration[] => {
	const slackName = `$slack_${literal}`;
	const rhs = Rational.neg(expr.constant);
	return [{ variable: slackName, kind, value: rhs, strict }];
};

type LinearExpr = {
	readonly coefficients: ReadonlyMap<string, Rational>;
	readonly constant: Rational;
};
