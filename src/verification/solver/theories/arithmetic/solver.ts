// Arithmetic theory facade for CDCL(T) integration.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/function";
import { match } from "ts-pattern";
import type { Literal } from "../../cdcl/core";
import type { Theory, TheoryCheck, TracedTheoryCheck } from "../theory";
import type { AtomInfo } from "../../cnf";
import type { IVL } from "../../ivl/types";
import { Simplex, type Tableau } from "./simplex";
import { Bounds, type BoundMap } from "./bounds";
import { Normalize, type LinearConstraint } from "./normalize";

// Justification for mutation: Theory interface is inherently stateful (assert/push/pop
// side-effect protocol). State is encapsulated here at the module boundary.
type ArithState = {
	tableau: Tableau;
	boundMap: BoundMap;
	integerVars: Set<string>;
	constraintMap: Map<Literal, { constraint: LinearConstraint; sort: IVL.NumSort }>;
	stateStack: { tableau: Tableau; boundMap: BoundMap }[];
};

export type ArithRegistration = {
	readonly literal: Literal;
	readonly info: AtomInfo;
};

export const Arithmetic = {
	create: (): { theory: Theory; state: ArithState } => {
		const state: ArithState = {
			tableau: Simplex.create(),
			boundMap: new Map(),
			integerVars: new Set(),
			constraintMap: new Map(),
			stateStack: [],
		};

		return { theory: buildTheory(state), state };
	},

	register: (state: ArithState, literal: Literal, info: AtomInfo, _positive: boolean): void =>
		pipe(Normalize.atom(info), result =>
			match(result)
				.with({ tag: "nonlinear" }, () => {})
				.with({ tag: "linear" }, ({ constraint, sort }) => {
					collectVariables(state, constraint, sort);
					const negated = Normalize.negate(constraint, sort);

					registerSlack(state, literal, constraint);

					state.constraintMap.set(literal, { constraint, sort });
					state.constraintMap.set(-literal, { constraint: negated, sort });

					state.boundMap = Bounds.register(state.boundMap, literal, constraint);
					state.boundMap = Bounds.register(state.boundMap, -literal, negated);
				})
				.exhaustive(),
		),
};

const registerSlack = (state: ArithState, literal: Literal, constraint: LinearConstraint): void =>
	match(constraint)
		.with({ tag: "neq" }, () => {})
		.otherwise(({ expr }) => {
			if (expr.coefficients.size > 1) {
				state.tableau = Simplex.addRow(state.tableau, `$slack_${literal}`, expr.coefficients);
			}
		});

const collectVariables = (state: ArithState, constraint: LinearConstraint, sort: IVL.NumSort): void => {
	constraint.expr.coefficients.forEach((_coeff, name) => {
		if (!state.tableau.assignment.has(name)) {
			state.tableau = Simplex.addVariable(state.tableau, name);
		}
		match(sort)
			.with({ tag: "Int" }, () => state.integerVars.add(name))
			.with({ tag: "Real" }, () => {})
			.exhaustive();
	});
};

const buildTheory = (state: ArithState): Theory => ({
	name: "arithmetic",

	assert: (literal: Literal): TheoryCheck =>
		pipe(
			O.fromNullable(state.constraintMap.get(literal)),
			O.match(
				() => E.right([]),
				() =>
					pipe(
						Bounds.assert(state.tableau, state.boundMap, literal),
						E.map(updated => {
							state.tableau = updated;
							return [];
						}),
					),
			),
		),

	check: (): TheoryCheck =>
		pipe(
			Simplex.check(state.tableau),
			E.map(updated => {
				state.tableau = updated;
				return [];
			}),
		),

	assertTrace: function* (literal: Literal): TracedTheoryCheck {
		const mapping = state.constraintMap.get(literal);

		if (!mapping) {
			return E.right([]);
		}

		const boundResult = yield* Bounds.assertTrace(state.tableau, state.boundMap, literal);
		return pipe(
			boundResult,
			E.map(updated => {
				state.tableau = updated;
				return [] as const;
			}),
		);
	},

	checkTrace: function* (): TracedTheoryCheck {
		const simplexResult = yield* Simplex.checkTrace(state.tableau);
		return pipe(
			simplexResult,
			E.map(updated => {
				state.tableau = updated;
				return [] as const;
			}),
		);
	},

	push: (): void => {
		state.stateStack.push({
			tableau: { ...state.tableau },
			boundMap: new Map(state.boundMap),
		});
	},

	pop: (): void =>
		pipe(
			O.fromNullable(state.stateStack.pop()),
			O.map(snapshot => {
				state.tableau = snapshot.tableau;
				state.boundMap = snapshot.boundMap;
			}),
		),

	explain: (literal: Literal): readonly Literal[] =>
		pipe(
			O.fromNullable(state.constraintMap.get(literal)),
			O.match(
				() => [],
				() => [literal],
			),
		),
});
