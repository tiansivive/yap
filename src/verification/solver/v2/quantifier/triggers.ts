// Trigger extraction for v2 quantifiers: finds E-matching patterns from annotations or function applications.
// E-matching = equality matching over EUF terms.
// https://github.com/tiansivive/z-yap/blob/main/zettels/e-matching.md

import { match } from "ts-pattern";
import { Patterns } from "../../ivl/patterns";
import type { IVL } from "../../ivl/types";
import type { Info } from "./model";

export const extract = (formula: IVL.Formula): Info[] =>
	match(formula)
		.with(Patterns.Formula.Forall, ({ binders, body, triggers, origin }) => {
			const names = binders.map(b => b.name);
			const patterns = match(triggers)
				.with(undefined, () => heuristic(body, names).map(terms => ({ terms, boundVars: names })))
				.otherwise(ts => ts.map(t => ({ terms: t.terms, boundVars: names })));
			return [{ binders, body, triggers: patterns, origin }, ...extract(body)];
		})
		.with(Patterns.Formula.And, ({ values }) => values.flatMap(extract))
		.with(Patterns.Formula.Or, ({ values }) => values.flatMap(extract))
		.with(Patterns.Formula.Not, ({ value }) => extract(value))
		.with(Patterns.Formula.Implies, ({ left, right }) => [...extract(left), ...extract(right)])
		.with(Patterns.Formula.Exists, ({ body }) => extract(body))
		.otherwise(() => []);

const heuristic = (body: IVL.Formula, names: string[]): IVL.Term[][] =>
	applications(body)
		.filter(term => mentions(term, names))
		.map(term => [term]);

const applications = (formula: IVL.Formula): IVL.Term[] =>
	match(formula)
		.with(Patterns.Formula.Atom, ({ args }) => [...terms(args[0]), ...terms(args[1])])
		.with(Patterns.Formula.And, ({ values }) => values.flatMap(applications))
		.with(Patterns.Formula.Or, ({ values }) => values.flatMap(applications))
		.with(Patterns.Formula.Implies, ({ left, right }) => [...applications(left), ...applications(right)])
		.with(Patterns.Formula.Not, ({ value }) => applications(value))
		.otherwise(() => []);

const terms = (term: IVL.Term): IVL.Term[] =>
	match(term)
		.with(Patterns.Term.App, t => [t, ...t.args.flatMap(terms)])
		.with(Patterns.Term.Arith, ({ args }) => [...terms(args[0]), ...terms(args[1])])
		.with(Patterns.Term.Select, ({ array, index }) => [...terms(array), ...terms(index)])
		.otherwise(() => []);

const mentions = (term: IVL.Term, names: string[]): boolean =>
	match(term)
		.with(Patterns.Term.Var, ({ name }) => names.includes(name))
		.with(Patterns.Term.App, ({ args }) => args.some(arg => mentions(arg, names)))
		.with(Patterns.Term.Arith, ({ args }) => args.some(arg => mentions(arg, names)))
		.with(Patterns.Term.Select, ({ array, index }) => mentions(array, names) || mentions(index, names))
		.otherwise(() => false);
