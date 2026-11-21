import { match } from "ts-pattern";
import { Build } from "./build";
import { Patterns } from "./patterns";
import type { IVL } from "./types";

// Each environment belongs to the current quantifier-free body. Nested quantifiers are separate instantiation sites.
export const interpret = (formula: IVL.Formula, env: ReadonlyMap<string, IVL.Term>): IVL.Formula =>
	match(formula)
		.with(Patterns.Formula.Atom, ({ op, args, origin }) => Build.atom(op, Term.substitute(args[0], env), Term.substitute(args[1], env), origin))
		.with(Patterns.Formula.And, ({ values, origin }) =>
			Build.andWithOrigin(
				values.map(f => interpret(f, env)),
				origin,
			),
		)
		.with(Patterns.Formula.Or, ({ values, origin }) =>
			Build.orWithOrigin(
				values.map(f => interpret(f, env)),
				origin,
			),
		)
		.with(Patterns.Formula.Not, ({ value, origin }) => Build.not(interpret(value, env), origin))
		.with(Patterns.Formula.Implies, ({ left, right, origin }) => Build.implies(interpret(left, env), interpret(right, env), origin))
		.with(Patterns.Formula.Forall, f => f)
		.with(Patterns.Formula.Exists, f => f)
		.with(Patterns.Formula.True, f => f)
		.with(Patterns.Formula.False, f => f)
		.exhaustive();

namespace Term {
	export const substitute = (term: IVL.Term, env: ReadonlyMap<string, IVL.Term>): IVL.Term =>
		match(term)
			.with(Patterns.Term.Var, ({ name, sort }) => env.get(name) ?? Build.var_(name, sort))
			.with(Patterns.Term.App, ({ head, args, sort }) =>
				Build.app(
					head,
					args.map(t => substitute(t, env)),
					sort,
				),
			)
			.with(Patterns.Term.Arith, ({ op, args, sort }) => Build.arith(op, substitute(args[0], env), substitute(args[1], env), sort))
			.with(Patterns.Term.Select, ({ array, index, sort }) => Build.select(substitute(array, env), substitute(index, env), sort))
			.with(Patterns.Term.Prop, () => {
				throw new Error("Formula normalization must eliminate Prop before substitution");
			})
			.otherwise(t => t);
}
