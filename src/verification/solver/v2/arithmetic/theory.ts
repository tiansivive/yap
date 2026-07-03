// Arithmetic theory facade for v2 theory orchestration.
// LIA = Linear Integer Arithmetic; LRA = Linear Real Arithmetic.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import * as E from "fp-ts/Either";
import type { Either } from "fp-ts/lib/Either";
import { match, P } from "ts-pattern";
import type { IVL } from "../../ivl/types";
import type { Conflict, Literal } from "../cdcl";
import type * as Encoding from "../encoding";
import { Bounds } from "./bounds";
import { type Constraint, Normalize } from "./normalize";
import type { Event as ArithmeticEvent } from "./simplex";
import { Simplex, type Tableau } from "./simplex";

export const State = {
	empty: {
		tableau: Simplex.empty,
		bounds: Bounds.empty,
		integerVars: new Set(),
		constraints: new Map(),
		stack: [],
	} satisfies State,

	register: (state: State, literal: Literal, atom: Encoding.Atom.T): State =>
		match(Normalize.atom(atom))
			.with({ tag: "nonlinear" }, () => state)
			.with({ tag: "linear" }, ({ constraint, sort }) => Registration.apply(state, literal, constraint, sort))
			.exhaustive(),

	assert: (state: State, literal: Literal): Check =>
		match(state.constraints.get(literal))
			.with(undefined, () => E.right({ state, propagations: [] }))
			.otherwise(() =>
				E.Functor.map(Bounds.assert(state.tableau, state.bounds, literal), tableau => ({
					state: { ...state, tableau },
					propagations: [],
				})),
			),

	check: (state: State): Check =>
		E.Functor.map(Simplex.check(state.tableau), tableau => ({
			state: { ...state, tableau },
			propagations: [],
		})),

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

export const Events = {
	assert: (state: State, literal: Literal): ArithmeticEvent[] =>
		(state.bounds.get(literal) ?? []).map(({ variable, kind, value, strict }) => ({
			tag: "bound" as const,
			variable,
			direction: kind,
			bound: { value, strict, reason: literal },
		})),

	check: (): ArithmeticEvent[] => [{ tag: "feasible" }],

	conflict: (conflict: Conflict): ArithmeticEvent[] =>
		match(/^arith:infeasible:(.+)$/.exec(conflict.clause.origin))
			.with(P.nonNullable, ([, variable]) => [{ tag: "infeasible" as const, variable }])
			.otherwise(() => []),
};

export type State = {
	readonly tableau: Tableau;
	readonly bounds: Bounds.Map;
	readonly integerVars: ReadonlySet<string>;
	readonly constraints: ReadonlyMap<Literal, Constraint.Info>;
	readonly stack: readonly Snapshot[];
};

export type Snapshot = {
	readonly tableau: Tableau;
	readonly bounds: Bounds.Map;
};

export type Update = {
	readonly state: State;
	readonly propagations: readonly Propagation[];
};

export type Check = Either<Conflict, Update>;

export type Propagation = {
	readonly literals: readonly Literal[];
	readonly justification: readonly Literal[];
};

export type Entry = {
	readonly literal: Literal;
	readonly atom: Encoding.Atom.T;
};

export type { Event } from "./simplex";

const Registration = {
	apply: (state: State, literal: Literal, constraint: Constraint, sort: IVL.NumSort): State => {
		const variables = Variables.collect(state, constraint, sort);
		const negated = Normalize.negate(constraint, sort);
		const tableau = Slack.register(variables.tableau, literal, constraint);
		return {
			...state,
			tableau,
			integerVars: variables.integerVars,
			constraints: new Map([...state.constraints, [literal, { constraint, sort }], [-literal, { constraint: negated, sort }]]),
			bounds: Bounds.register(Bounds.register(state.bounds, literal, constraint), -literal, negated),
		};
	},
};

const Variables = {
	collect: (state: State, constraint: Constraint, sort: IVL.NumSort): { readonly tableau: Tableau; readonly integerVars: ReadonlySet<string> } =>
		[...constraint.expr.coefficients.keys()].reduce<{ readonly tableau: Tableau; readonly integerVars: ReadonlySet<string> }>(
			(acc, name) => ({
				tableau: acc.tableau.assignment.has(name) ? acc.tableau : Simplex.variable(acc.tableau, name),
				integerVars: match(sort)
					.with({ tag: "Int" }, () => new Set([...acc.integerVars, name]))
					.with({ tag: "Real" }, () => acc.integerVars)
					.exhaustive(),
			}),
			{ tableau: state.tableau, integerVars: state.integerVars },
		),
};

const Slack = {
	register: (tableau: Tableau, literal: Literal, constraint: Constraint): Tableau =>
		match(constraint)
			.with({ tag: "neq" }, () => tableau)
			.otherwise(({ expr }) =>
				match(expr.coefficients.size)
					.with(1, () => tableau)
					.otherwise(() => Simplex.row(tableau, `$slack_${literal}`, expr.coefficients)),
			),
};
