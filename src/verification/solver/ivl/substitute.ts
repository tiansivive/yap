import { match } from "ts-pattern";
import { Build } from "./build";
import { Patterns } from "./patterns";
import type { IVL } from "./types";

// MBQI returns a standalone residual formula, and normalization instantiates predicate definitions.
// TODO: Let both consumers resolve variables from the environment as they visit a body,
// materializing the result only when a caller needs a standalone formula.
export namespace Substitute {
	export const formula = (input: IVL.Formula, env: ReadonlyMap<string, IVL.Term>): IVL.Formula =>
		match(input)
			.with(Patterns.Formula.Atom, ({ op, args, origin }) => Build.atom(op, term(args[0], env), term(args[1], env), origin))
			.with(Patterns.Formula.And, ({ values, origin }) =>
				Build.andWithOrigin(
					values.map(f => formula(f, env)),
					origin,
				),
			)
			.with(Patterns.Formula.Or, ({ values, origin }) =>
				Build.orWithOrigin(
					values.map(f => formula(f, env)),
					origin,
				),
			)
			.with(Patterns.Formula.Not, ({ value, origin }) => Build.not(formula(value, env), origin))
			.with(Patterns.Formula.Implies, ({ left, right, origin }) => Build.implies(formula(left, env), formula(right, env), origin))
			.with(Patterns.Formula.Forall, f => f)
			.with(Patterns.Formula.Exists, f => f)
			.with(Patterns.Formula.True, f => f)
			.with(Patterns.Formula.False, f => f)
			.exhaustive();

	const term = (input: IVL.Term, env: ReadonlyMap<string, IVL.Term>): IVL.Term =>
		match(input)
			.with(Patterns.Term.Var, ({ name, sort }) => env.get(name) ?? Build.var_(name, sort))
			.with(Patterns.Term.App, ({ head, args, sort }) =>
				Build.app(
					head,
					args.map(t => term(t, env)),
					sort,
				),
			)
			.with(Patterns.Term.Arith, ({ op, args, sort }) => Build.arith(op, term(args[0], env), term(args[1], env), sort))
			.with(Patterns.Term.Select, ({ array, index, sort }) => Build.select(term(array, env), term(index, env), sort))
			.with(Patterns.Term.Prop, () => {
				throw new Error("Formula normalization must eliminate Prop before substitution");
			})
			.otherwise(t => t);
}
