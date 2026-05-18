// Skolemization: replaces existentially quantified variables with fresh Skolem functions
// whose arguments are the universally quantified variables in scope.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import { match } from "ts-pattern";
import { IVL } from "./ivl/types";
import { Build } from "./ivl/build";

export const skolemize = (formula: IVL.Formula): IVL.Formula => skolemizeRec(formula, [], 0).formula;

type SkolemCtx = {
	readonly formula: IVL.Formula;
	readonly counter: number;
};

const skolemizeRec = (formula: IVL.Formula, universals: readonly IVL.Binder[], counter: number): SkolemCtx =>
	match(formula)
		.with({ tag: "Exists" }, ({ binders, body, origin }) => {
			const substitutions = binders.map((b, i) => ({
				from: b.name,
				to: skolemTerm(counter + i, b.sort, universals),
			}));

			const substituted = substitutions.reduce((f, sub) => substituteInFormula(f, sub.from, sub.to), body);

			return skolemizeRec(substituted, universals, counter + binders.length);
		})
		.with({ tag: "Forall" }, ({ binders, body, triggers, origin }) => {
			const inner = skolemizeRec(body, [...universals, ...binders], counter);
			return {
				formula: { tag: "Forall" as const, binders, body: inner.formula, triggers, origin },
				counter: inner.counter,
			};
		})
		.with({ tag: "And" }, ({ values, origin }) => {
			const result = values.reduce<{ formulas: IVL.Formula[]; counter: number }>(
				(acc, v) => {
					const r = skolemizeRec(v, universals, acc.counter);
					return { formulas: [...acc.formulas, r.formula], counter: r.counter };
				},
				{ formulas: [], counter },
			);
			return { formula: { tag: "And" as const, values: result.formulas, origin }, counter: result.counter };
		})
		.with({ tag: "Or" }, ({ values, origin }) => {
			const result = values.reduce<{ formulas: IVL.Formula[]; counter: number }>(
				(acc, v) => {
					const r = skolemizeRec(v, universals, acc.counter);
					return { formulas: [...acc.formulas, r.formula], counter: r.counter };
				},
				{ formulas: [], counter },
			);
			return { formula: { tag: "Or" as const, values: result.formulas, origin }, counter: result.counter };
		})
		.with({ tag: "Not" }, ({ value, origin }) => {
			const inner = skolemizeRec(value, universals, counter);
			return { formula: { tag: "Not" as const, value: inner.formula, origin }, counter: inner.counter };
		})
		.with({ tag: "Implies" }, ({ left, right, origin }) => {
			const l = skolemizeRec(left, universals, counter);
			const r = skolemizeRec(right, universals, l.counter);
			return { formula: { tag: "Implies" as const, left: l.formula, right: r.formula, origin }, counter: r.counter };
		})
		.with({ tag: "True" }, f => ({ formula: f, counter }))
		.with({ tag: "False" }, f => ({ formula: f, counter }))
		.with({ tag: "Atom" }, f => ({ formula: f, counter }))
		.exhaustive();

const skolemTerm = (id: number, sort: IVL.Sort, universals: readonly IVL.Binder[]): IVL.Term => {
	const name = `sk_${id}`;

	if (universals.length === 0) {
		return Build.const_(name, sort);
	}

	return Build.app(
		name,
		universals.map(u => Build.var_(u.name, u.sort)),
		sort,
	);
};

const substituteInFormula = (formula: IVL.Formula, name: string, replacement: IVL.Term): IVL.Formula =>
	match(formula)
		.with({ tag: "Atom" }, ({ op, args, origin }) =>
			Build.atom(op, substituteInTerm(args[0], name, replacement), substituteInTerm(args[1], name, replacement), origin),
		)
		.with({ tag: "Not" }, ({ value, origin }) => ({
			tag: "Not" as const,
			value: substituteInFormula(value, name, replacement),
			origin,
		}))
		.with({ tag: "And" }, ({ values, origin }) => ({
			tag: "And" as const,
			values: values.map(v => substituteInFormula(v, name, replacement)),
			origin,
		}))
		.with({ tag: "Or" }, ({ values, origin }) => ({
			tag: "Or" as const,
			values: values.map(v => substituteInFormula(v, name, replacement)),
			origin,
		}))
		.with({ tag: "Implies" }, ({ left, right, origin }) => ({
			tag: "Implies" as const,
			left: substituteInFormula(left, name, replacement),
			right: substituteInFormula(right, name, replacement),
			origin,
		}))
		.with({ tag: "Forall" }, ({ binders, body, triggers, origin }) => {
			if (binders.some(b => b.name === name)) {
				return formula;
			}
			return {
				tag: "Forall" as const,
				binders,
				body: substituteInFormula(body, name, replacement),
				triggers: triggers?.map(t => ({ terms: t.terms.map(term => substituteInTerm(term, name, replacement)) })),
				origin,
			};
		})
		.with({ tag: "Exists" }, ({ binders, body, origin }) => {
			if (binders.some(b => b.name === name)) {
				return formula;
			}
			return {
				tag: "Exists" as const,
				binders,
				body: substituteInFormula(body, name, replacement),
				origin,
			};
		})
		.with({ tag: "True" }, f => f)
		.with({ tag: "False" }, f => f)
		.exhaustive();

const substituteInTerm = (term: IVL.Term, name: string, replacement: IVL.Term): IVL.Term =>
	match(term)
		.with({ tag: "Var" }, t => (t.name === name ? replacement : t))
		.with({ tag: "App" }, ({ head, args, sort }) =>
			Build.app(
				head,
				args.map(a => substituteInTerm(a, name, replacement)),
				sort,
			),
		)
		.with({ tag: "Arith" }, ({ op, args, sort }) =>
			Build.arith(op, substituteInTerm(args[0], name, replacement), substituteInTerm(args[1], name, replacement), sort),
		)
		.with({ tag: "Select" }, ({ array, index, sort }) =>
			Build.select(substituteInTerm(array, name, replacement), substituteInTerm(index, name, replacement), sort),
		)
		.with({ tag: "Const" }, t => t)
		.with({ tag: "Num" }, t => t)
		.with({ tag: "Bool" }, t => t)
		.with({ tag: "Str" }, t => t)
		.with({ tag: "Row" }, t => t)
		.exhaustive();
