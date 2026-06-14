// Skolemization for the v2 solver pipeline.
// IVL = Intermediate Verification Language.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import { match, P } from "ts-pattern";
import { Build } from "../../ivl/build";
import type { IVL } from "../../ivl/types";

const Patterns = {
	Term: {
		Var: { tag: "Var" } as const,
		App: { tag: "App" } as const,
		Arith: { tag: "Arith" } as const,
		Select: { tag: "Select" } as const,
	},
	Formula: {
		Atom: { tag: "Atom" } as const,
		Not: { tag: "Not" } as const,
		And: { tag: "And" } as const,
		Or: { tag: "Or" } as const,
		Implies: { tag: "Implies" } as const,
		Forall: { tag: "Forall" } as const,
		Exists: { tag: "Exists" } as const,
		True: { tag: "True" } as const,
		False: { tag: "False" } as const,
	},
} as const;

export const skolemize = (formula: IVL.Formula): IVL.Formula => go(formula, [], 0).formula;

export type State = {
	formula: IVL.Formula;
	counter: number;
};

export type Sub = {
	from: string;
	to: IVL.Term;
};

const go = (formula: IVL.Formula, universals: IVL.Binder[], counter: number): State =>
	match(formula)
		.with(Patterns.Formula.Exists, ({ binders, body }) => {
			const subs = binders.map((b, i) => ({ from: b.name, to: term(counter + i, b.sort, universals) }));
			return go(
				subs.reduce((f, sub) => Formula.substitute(f, sub), body),
				universals,
				counter + binders.length,
			);
		})
		.with(Patterns.Formula.Forall, ({ binders, body, triggers, origin }) => {
			const inner = go(body, [...universals, ...binders], counter);
			return { formula: Build.forall(binders, inner.formula, origin, triggers), counter: inner.counter };
		})
		.with(Patterns.Formula.And, ({ values, origin }) => combine("And", values, origin, universals, counter))
		.with(Patterns.Formula.Or, ({ values, origin }) => combine("Or", values, origin, universals, counter))
		.with(Patterns.Formula.Not, ({ value, origin }) => {
			const inner = go(value, universals, counter);
			return { formula: Build.not(inner.formula, origin), counter: inner.counter };
		})
		.with(Patterns.Formula.Implies, ({ left, right, origin }) => {
			const l = go(left, universals, counter);
			const r = go(right, universals, l.counter);
			return { formula: Build.implies(l.formula, r.formula, origin), counter: r.counter };
		})
		.with(P.union(Patterns.Formula.True, Patterns.Formula.False, Patterns.Formula.Atom), f => ({ formula: f, counter }))
		.exhaustive();

const combine = (tag: "And" | "Or", values: IVL.Formula[], origin: string | undefined, universals: IVL.Binder[], counter: number): State => {
	const result = values.reduce<{ formulas: IVL.Formula[]; counter: number }>(
		(acc, value) => {
			const r = go(value, universals, acc.counter);
			return { formulas: [...acc.formulas, r.formula], counter: r.counter };
		},
		{ formulas: [], counter },
	);

	return match(tag)
		.with("And", () => ({ formula: Build.andWithOrigin([...result.formulas], origin), counter: result.counter }))
		.with("Or", () => ({ formula: Build.orWithOrigin([...result.formulas], origin), counter: result.counter }))
		.exhaustive();
};

const term = (id: number, sort: IVL.Sort, universals: IVL.Binder[]): IVL.Term =>
	match(universals)
		.with([], () => Build.const_(`sk_${id}`, sort))
		.otherwise(us =>
			Build.app(
				`sk_${id}`,
				us.map(u => Build.var_(u.name, u.sort)),
				sort,
			),
		);

namespace Formula {
	export const substitute = (formula: IVL.Formula, sub: Sub): IVL.Formula =>
		match(formula)
			.with(Patterns.Formula.Atom, ({ op, args, origin }) => Build.atom(op, Term.substitute(args[0], sub), Term.substitute(args[1], sub), origin))
			.with(Patterns.Formula.Not, ({ value, origin }) => Build.not(substitute(value, sub), origin))
			.with(Patterns.Formula.And, ({ values, origin }) =>
				Build.andWithOrigin(
					values.map(f => substitute(f, sub)),
					origin,
				),
			)
			.with(Patterns.Formula.Or, ({ values, origin }) =>
				Build.orWithOrigin(
					values.map(f => substitute(f, sub)),
					origin,
				),
			)
			.with(Patterns.Formula.Implies, ({ left, right, origin }) => Build.implies(substitute(left, sub), substitute(right, sub), origin))
			.with(Patterns.Formula.Forall, ({ binders, body, triggers, origin }) =>
				match(binders.some(b => b.name === sub.from))
					.with(true, () => formula)
					.with(false, () =>
						Build.forall(
							binders,
							substitute(body, sub),
							origin,
							triggers?.map(t => ({ terms: t.terms.map(x => Term.substitute(x, sub)) })),
						),
					)
					.exhaustive(),
			)
			.with(Patterns.Formula.Exists, ({ binders, body, origin }) =>
				match(binders.some(b => b.name === sub.from))
					.with(true, () => formula)
					.with(false, () => Build.exists(binders, substitute(body, sub), origin))
					.exhaustive(),
			)
			.with(P.union(Patterns.Formula.True, Patterns.Formula.False), f => f)
			.exhaustive();
}

namespace Term {
	export const substitute = (term: IVL.Term, sub: Sub): IVL.Term =>
		match(term)
			.with(Patterns.Term.Var, t =>
				match(t.name)
					.with(sub.from, () => sub.to)
					.otherwise(() => t),
			)
			.with(Patterns.Term.App, ({ head, args, sort }) =>
				Build.app(
					head,
					args.map(a => substitute(a, sub)),
					sort,
				),
			)
			.with(Patterns.Term.Arith, ({ op, args, sort }) => Build.arith(op, substitute(args[0], sub), substitute(args[1], sub), sort))
			.with(Patterns.Term.Select, ({ array, index, sort }) => Build.select(substitute(array, sub), substitute(index, sub), sort))
			.otherwise(t => t);
}
