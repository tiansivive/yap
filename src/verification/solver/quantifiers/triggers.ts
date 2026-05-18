// Trigger extraction: identifies sub-terms in quantified formula bodies that serve
// as E-matching triggers for instantiation. Prefers user-annotated triggers, falls
// back to heuristic extraction of function applications containing bound variables.
// https://github.com/tiansivive/z-yap/blob/main/zettels/e-matching.md

import { match } from "ts-pattern";
import { IVL } from "../ivl/types";

export type TriggerPattern = {
	readonly terms: readonly IVL.Term[];
	readonly boundVars: readonly string[];
};

export type QuantifierInfo = {
	readonly binders: readonly IVL.Binder[];
	readonly body: IVL.Formula;
	readonly triggers: readonly TriggerPattern[];
	readonly origin?: string;
};

export const Triggers = {
	extract: (formula: IVL.Formula): readonly QuantifierInfo[] =>
		match(formula)
			.with({ tag: "Forall" }, ({ binders, body, triggers, origin }) => {
				const boundNames = binders.map(b => b.name);

				const patterns: TriggerPattern[] =
					triggers && triggers.length > 0
						? triggers.map(t => ({ terms: t.terms, boundVars: boundNames }))
						: heuristicTriggers(body, boundNames).map(terms => ({ terms, boundVars: boundNames }));

				const nested = extractFromBody(body);

				return [{ binders, body, triggers: patterns, origin }, ...nested];
			})
			.with({ tag: "And" }, ({ values }) => values.flatMap(Triggers.extract))
			.with({ tag: "Or" }, ({ values }) => values.flatMap(Triggers.extract))
			.with({ tag: "Not" }, ({ value }) => Triggers.extract(value))
			.with({ tag: "Implies" }, ({ left, right }) => [...Triggers.extract(left), ...Triggers.extract(right)])
			.with({ tag: "Exists" }, ({ body }) => Triggers.extract(body))
			.otherwise(() => []),
};

const extractFromBody = (formula: IVL.Formula): readonly QuantifierInfo[] =>
	match(formula)
		.with({ tag: "Forall" }, () => Triggers.extract(formula))
		.with({ tag: "And" }, ({ values }) => values.flatMap(extractFromBody))
		.with({ tag: "Or" }, ({ values }) => values.flatMap(extractFromBody))
		.with({ tag: "Implies" }, ({ left, right }) => [...extractFromBody(left), ...extractFromBody(right)])
		.with({ tag: "Not" }, ({ value }) => extractFromBody(value))
		.otherwise(() => []);

const heuristicTriggers = (body: IVL.Formula, boundVars: readonly string[]): readonly (readonly IVL.Term[])[] => {
	const candidates = collectApplications(body).filter(term => mentionsBoundVar(term, boundVars));

	if (candidates.length === 0) {
		return [];
	}

	return candidates.map(t => [t]);
};

const collectApplications = (formula: IVL.Formula): readonly IVL.Term[] =>
	match(formula)
		.with({ tag: "Atom" }, ({ args }) => [...collectTermApps(args[0]), ...collectTermApps(args[1])])
		.with({ tag: "And" }, ({ values }) => values.flatMap(collectApplications))
		.with({ tag: "Or" }, ({ values }) => values.flatMap(collectApplications))
		.with({ tag: "Implies" }, ({ left, right }) => [...collectApplications(left), ...collectApplications(right)])
		.with({ tag: "Not" }, ({ value }) => collectApplications(value))
		.otherwise(() => []);

const collectTermApps = (term: IVL.Term): readonly IVL.Term[] =>
	match(term)
		.with({ tag: "App" }, t => [t, ...t.args.flatMap(collectTermApps)])
		.with({ tag: "Arith" }, ({ args }) => [...collectTermApps(args[0]), ...collectTermApps(args[1])])
		.with({ tag: "Select" }, ({ array, index }) => [...collectTermApps(array), ...collectTermApps(index)])
		.otherwise(() => []);

const mentionsBoundVar = (term: IVL.Term, boundVars: readonly string[]): boolean =>
	match(term)
		.with({ tag: "Var" }, ({ name }) => boundVars.includes(name))
		.with({ tag: "App" }, ({ args }) => args.some(a => mentionsBoundVar(a, boundVars)))
		.with({ tag: "Arith" }, ({ args }) => args.some(a => mentionsBoundVar(a, boundVars)))
		.with({ tag: "Select" }, ({ array, index }) => mentionsBoundVar(array, boundVars) || mentionsBoundVar(index, boundVars))
		.otherwise(() => false);
