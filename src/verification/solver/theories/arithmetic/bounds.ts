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
import { ArithTrace } from "../theory";

import * as Fold from "fp-ts/Foldable";

import * as A from "fp-ts/Array";

export type BoundRegistration = {
	readonly variable: string;
	readonly kind: "lower" | "upper";
	readonly value: Rational;
	readonly strict: boolean;
};

export type BoundMap = ReadonlyMap<Literal, BoundRegistration[]>;

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

		const fold = Fold.reduceM(E.Monad, A.Foldable);
		return pipe(
			registrations,
			fold(tab, (acc, reg) => {
				const bound: Bound = { value: reg.value, strict: reg.strict, reason: literal };
				return match(reg.kind)
					.with("lower", () => Simplex.Assert.lower(acc, reg.variable, bound))
					.with("upper", () => Simplex.Assert.upper(acc, reg.variable, bound))
					.exhaustive();
			}),
		);
	},

	assertTrace: function* (tab: Tableau, map: BoundMap, literal: Literal): Generator<ArithTrace.Step, E.Either<Conflict, Tableau>> {
		const registrations = map.get(literal);

		if (!registrations) {
			return E.right(tab);
		}

		const step = function* (current: E.Either<Conflict, Tableau>, regs: readonly BoundRegistration[]): Generator<ArithTrace.Step, E.Either<Conflict, Tableau>> {
			if (regs.length === 0 || E.isLeft(current)) {
				return current;
			}

			const [head, ...tail] = regs;
			const bound: Bound = { value: head.value, strict: head.strict, reason: literal };
			yield { tag: "bound", variable: head.variable, kind: head.kind, value: head.value, strict: head.strict } satisfies ArithTrace.Step;

			const result = E.Monad.chain(current, t =>
				match(head.kind)
					.with("lower", () => Simplex.Assert.lower(t, head.variable, bound))
					.with("upper", () => Simplex.Assert.upper(t, head.variable, bound))
					.exhaustive(),
			);

			if (E.isLeft(result)) {
				const bp = current.right.bounds.get(head.variable);
				const lower = head.kind === "lower" ? head.value : (bp?.lower?.value ?? Rational.zero);
				const upper = head.kind === "upper" ? head.value : (bp?.upper?.value ?? Rational.zero);
				yield { tag: "bound-conflict", variable: head.variable, lower, upper } satisfies ArithTrace.Step;
				return result;
			}

			return yield* step(result, tail);
		};

		return yield* step(E.right(tab), registrations);
	},
};

// Single-variable constraints become direct bounds.
// Multi-variable constraints introduce a slack variable with the constraint as its row.
const constraintToBounds = (literal: Literal, constraint: LinearConstraint): BoundRegistration[] =>
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
