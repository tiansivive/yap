/* eslint-disable @typescript-eslint/no-namespace */
// Grounding substitutes MBQI candidates into quantified bodies and classifies the simplified result.
// MBQI = Model-Based Quantifier Instantiation.
// https://github.com/tiansivive/z-yap/blob/main/zettels/mbqi.md

import { match } from "ts-pattern";
import { Build } from "../../../ivl/build";
import { Patterns } from "../../../ivl/patterns";
import type { IVL } from "../../../ivl/types";
import type { Simplification } from "../model";

export const ground = (formula: IVL.Formula, candidate: Candidate): Simplification => simplify(Formula.substitute(formula, candidate));

export type Candidate = ReadonlyMap<string, IVL.Term>;

namespace Formula {
	export const substitute = (formula: IVL.Formula, candidate: Candidate): IVL.Formula =>
		match(formula)
			.with(Patterns.Formula.Atom, ({ op, args, origin }) => Build.atom(op, Term.substitute(args[0], candidate), Term.substitute(args[1], candidate), origin))
			.with(Patterns.Formula.And, ({ values, origin }) =>
				Build.andWithOrigin(
					values.map(f => substitute(f, candidate)),
					origin,
				),
			)
			.with(Patterns.Formula.Or, ({ values, origin }) =>
				Build.orWithOrigin(
					values.map(f => substitute(f, candidate)),
					origin,
				),
			)
			.with(Patterns.Formula.Not, ({ value, origin }) => Build.not(substitute(value, candidate), origin))
			.with(Patterns.Formula.Implies, ({ left, right, origin }) => Build.implies(substitute(left, candidate), substitute(right, candidate), origin))
			.with(Patterns.Formula.Forall, f => f)
			.with(Patterns.Formula.Exists, f => f)
			.with(Patterns.Formula.True, f => f)
			.with(Patterns.Formula.False, f => f)
			.exhaustive();
}

const simplify = (formula: IVL.Formula): Simplification =>
	match(formula)
		.with(Patterns.Formula.True, () => ({ tag: "tautology" }) satisfies Simplification)
		.with(Patterns.Formula.False, () => ({ tag: "contradiction" }) satisfies Simplification)
		.otherwise(f => ({ tag: "residual", formula: f }) satisfies Simplification);

namespace Term {
	export const substitute = (term: IVL.Term, candidate: Candidate): IVL.Term =>
		match(term)
			.with(Patterns.Term.Var, ({ name, sort }) => candidate.get(name) ?? Build.var_(name, sort))
			.with(Patterns.Term.App, ({ head, args, sort }) =>
				Build.app(
					head,
					args.map(t => substitute(t, candidate)),
					sort,
				),
			)
			.with(Patterns.Term.Arith, ({ op, args, sort }) => Build.arith(op, substitute(args[0], candidate), substitute(args[1], candidate), sort))
			.with(Patterns.Term.Select, ({ array, index, sort }) => Build.select(substitute(array, candidate), substitute(index, candidate), sort))
			.otherwise(t => t);
}
