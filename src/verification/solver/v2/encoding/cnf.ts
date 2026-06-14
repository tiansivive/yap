/* eslint-disable @typescript-eslint/no-namespace */
// CNF encoding for v2 formulas, implemented with an internal Tseitin transform.
// CNF = Conjunctive Normal Form; Tseitin introduces proxies to avoid exponential blowup.
// https://github.com/tiansivive/z-yap/blob/main/zettels/tseitin-cnf.md

import { match, P } from "ts-pattern";
import type { IVL } from "../../ivl/types";
import type * as CDCL from "../cdcl";
import type * as Enc from "../encoding";
import * as Keys from "./keys";

export const encode = (formula: IVL.Formula): Enc.State => Tseitin.encode(formula);

namespace Tseitin {
	type State = Enc.State & {
		nextClauseId: number;
	};

	type Result = {
		literal: CDCL.Literal;
		state: State;
	};

	const initial: State = {
		clauses: [],
		keyIndex: new Map(),
		atoms: new Map(),
		proxies: new Map(),
		nextVar: 1,
		nextClauseId: 0,
	};

	export const encode = (formula: IVL.Formula): Enc.State => {
		const { literal, state } = formula_(initial, formula);
		const final = Clause.add(state, [literal], formula.origin ?? "top");
		return strip(final);
	};

	const formula_ = (state: State, formula: IVL.Formula): Result =>
		match(formula)
			.with({ tag: "True" }, () => {
				const { variable, state: next } = Variable.fresh(state);
				return { literal: variable, state: Clause.add(Proxy.add(next, variable, { tag: "true", operands: [] }), [variable], "true") };
			})
			.with({ tag: "False" }, () => {
				const { variable, state: next } = Variable.fresh(state);
				return { literal: variable, state: Clause.add(Proxy.add(next, variable, { tag: "false", operands: [] }), [-variable], "false") };
			})
			.with({ tag: "Atom" }, ({ op, args }) => Atom.encode(state, op, args))
			.with({ tag: "Not" }, ({ value }) => {
				const inner = formula_(state, value);
				return { literal: -inner.literal, state: inner.state };
			})
			.with({ tag: "And" }, ({ values, origin }) => Connective.and(state, values, origin))
			.with({ tag: "Or" }, ({ values, origin }) => Connective.or(state, values, origin))
			.with({ tag: "Implies" }, ({ left, right, origin }) => Connective.implies(state, left, right, origin))
			.with({ tag: "Forall" }, () => Proxy.quantified(state, "forall"))
			.with({ tag: "Exists" }, () => Proxy.quantified(state, "exists"))
			.exhaustive();

	namespace Atom {
		export const encode = (state: State, op: IVL.AtomOp, args: [IVL.Term, IVL.Term]): Result =>
			match(state.keyIndex.get(Keys.atom(op, args)))
				.with(P.number, literal => ({ literal, state }))
				.with(undefined, () => {
					const { variable, state: next } = Variable.fresh(state);
					return {
						literal: variable,
						state: {
							...next,
							keyIndex: new Map([...next.keyIndex, [Keys.atom(op, args), variable]]),
							atoms: new Map([...next.atoms, [variable, { op, args }]]),
						},
					};
				})
				.exhaustive();
	}

	namespace Connective {
		export const and = (state: State, values: IVL.Formula[], origin?: string): Result => {
			const encoded = many(state, values);
			const { variable, state: next } = Variable.fresh(encoded.state);
			const withProxy = Proxy.add(next, variable, { tag: "and", operands: encoded.literals });
			const left = encoded.literals.reduce((s, lit) => Clause.add(s, [-variable, lit], origin ?? "and"), withProxy);
			return { literal: variable, state: Clause.add(left, [...encoded.literals.map(Literal.negate), variable], origin ?? "and") };
		};

		export const or = (state: State, values: IVL.Formula[], origin?: string): Result => {
			const encoded = many(state, values);
			const { variable, state: next } = Variable.fresh(encoded.state);
			const withProxy = Proxy.add(next, variable, { tag: "or", operands: encoded.literals });
			const left = Clause.add(withProxy, [-variable, ...encoded.literals], origin ?? "or");
			return { literal: variable, state: encoded.literals.reduce((s, lit) => Clause.add(s, [-lit, variable], origin ?? "or"), left) };
		};

		export const implies = (state: State, left: IVL.Formula, right: IVL.Formula, origin?: string): Result => {
			const l = formula_(state, left);
			const r = formula_(l.state, right);
			const { variable, state: next } = Variable.fresh(r.state);
			const withProxy = Proxy.add(next, variable, { tag: "implies", operands: [l.literal, r.literal] });
			const one = Clause.add(withProxy, [-variable, -l.literal, r.literal], origin ?? "implies");
			const two = Clause.add(one, [l.literal, variable], origin ?? "implies");
			return { literal: variable, state: Clause.add(two, [-r.literal, variable], origin ?? "implies") };
		};
	}

	const many = (state: State, formulas: IVL.Formula[]): { literals: CDCL.Literal[]; state: State } =>
		formulas.reduce<{ literals: CDCL.Literal[]; state: State }>(
			(acc, formula) => {
				const encoded = formula_(acc.state, formula);
				return { literals: [...acc.literals, encoded.literal], state: encoded.state };
			},
			{ literals: [], state },
		);

	namespace Clause {
		export const add = (state: State, literals: CDCL.Literal[], origin: string): State => ({
			...state,
			clauses: [...state.clauses, { id: state.nextClauseId, literals: [...literals], origin }],
			nextClauseId: state.nextClauseId + 1,
		});
	}

	namespace Literal {
		export const negate = (literal: CDCL.Literal): CDCL.Literal => -literal;
	}

	namespace Proxy {
		export const add = (state: State, variable: CDCL.Variable, proxy: Enc.Proxy): State => ({
			...state,
			proxies: new Map([...state.proxies, [variable, proxy]]),
		});

		export const quantified = (state: State, tag: "forall" | "exists"): Result => {
			const { variable, state: next } = Variable.fresh(state);
			return { literal: variable, state: add(next, variable, { tag, operands: [] }) };
		};
	}

	namespace Variable {
		export const fresh = (state: State): { variable: CDCL.Variable; state: State } => ({
			variable: state.nextVar,
			state: { ...state, nextVar: state.nextVar + 1 },
		});
	}

	const strip = ({ clauses, keyIndex, atoms, proxies, nextVar }: State): Enc.State => ({ clauses, keyIndex, atoms, proxies, nextVar });
}
