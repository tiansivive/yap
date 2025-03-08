import * as NF from "@qtt/elaboration/normalization";
import * as EB from "@qtt/elaboration";

import * as R from "@qtt/shared/rows";

import { match } from "ts-pattern";
import { entries } from "../../utils/objects";

export type Subst = { [key: number]: NF.Value };

//TODO: term substitution is failing. It's not adding introduced abstractions to the environment, so the lookup fails with negative indices.
//SOLUTION: When going under an abstraction, we need to add the binder to the environment.
//NOTE: Working with a Context is a bad idea. Substitution doesn't care about most of the context, it only cares about the environment and imports.
export const Substitute = (ctx: EB.Context) => {
	const call = {
		nf: (subst: Subst, val: NF.Value, level = ctx.env.length): NF.Value => Substitute(ctx).nf(subst, val, level),
		closure: (subst: Subst, closure: NF.Closure): NF.Closure => Substitute(ctx).closure(subst, closure),
		term: (subst: Subst, term: EB.Term, level: number): EB.Term => Substitute(ctx).term(subst, term, level),
	};

	return {
		nf: (subst: Subst, val: NF.Value, level = ctx.env.length): NF.Value => {
			if (Object.keys(subst).length === 0) {
				return val;
			}
			return match(val)
				.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(call.nf(subst, value, level)))
				.with(NF.Patterns.Lit, () => val)
				.with(NF.Patterns.Rigid, () => val)
				.with(NF.Patterns.Flex, ({ variable }) => subst[variable.val] ?? val)
				.with(NF.Patterns.Lambda, ({ binder, closure }) => NF.Constructors.Lambda(binder.variable, binder.icit, call.closure(subst, closure)))
				.with(NF.Patterns.Pi, ({ closure, binder }) => {
					const pi = NF.Constructors.Pi(
						binder.variable,
						binder.icit,
						[call.nf(subst, binder.annotation[0], level), binder.annotation[1]],
						call.closure(subst, closure),
					);

					return pi;
				})
				.with(NF.Patterns.Mu, ({ closure, binder }) => {
					const mu = NF.Constructors.Mu(
						binder.variable,
						binder.source,
						[call.nf(subst, binder.annotation[0], level), binder.annotation[1]],
						call.closure(subst, closure),
					);
					return mu;
				})

				.with(NF.Patterns.App, ({ func, arg, icit }) => NF.Constructors.App(call.nf(subst, func, level), call.nf(subst, arg, level), icit))
				.with(NF.Patterns.Row, ({ row }) => {
					const r = R.traverse(
						row,
						val => call.nf(subst, val, level),
						v => {
							if (v.type === "Meta") {
								const nf = subst[v.val];

								if (!nf) {
									return R.Constructors.Variable(v);
								}

								if (nf.type === "Row") {
									return nf.row;
								}

								if (nf.type === "Var") {
									return R.Constructors.Variable(nf.variable);
								}

								throw new Error("Substitute: Row variable is not a row or a variable: " + NF.display(nf));
							}

							return R.Constructors.Variable(v);
						},
					);

					return NF.Constructors.Row(r);
				})
				.otherwise(val => {
					throw new Error("Substitute: Not implemented yet: " + NF.display(val));
				});
		},

		closure: (subst: Subst, closure: NF.Closure): NF.Closure => ({
			env: closure.env,
			term: Substitute(ctx).term(subst, closure.term, closure.env.length + 1),
		}),
		term: (subst: Subst, term: EB.Term, level = ctx.env.length): EB.Term => {
			return match(term)
				.with({ type: "Lit" }, () => term)
				.with({ type: "Var" }, ({ variable }) => {
					if (variable.type === "Meta") {
						return subst[variable.val] ? NF.quote(ctx.imports, level, subst[variable.val]) : term;
					}

					return term;
				})
				.with({ type: "Abs" }, ({ binding, body }) => {
					if (binding.type === "Lambda") {
						return EB.Constructors.Abs(binding, call.term(subst, body, level + 1));
					}

					const annotation = call.term(subst, binding.annotation, level);
					return EB.Constructors.Abs({ ...binding, annotation }, call.term(subst, body, level + 1));
				})
				.with({ type: "App" }, ({ func, arg, icit }) => EB.Constructors.App(icit, call.term(subst, func, level), call.term(subst, arg, level)))
				.with({ type: "Proj" }, ({ label, term }) => EB.Constructors.Proj(label, call.term(subst, term, level)))
				.with({ type: "Inj" }, ({ label, value, term }) => EB.Constructors.Inj(label, call.term(subst, value, level), call.term(subst, term, level)))
				.with({ type: "Annotation" }, ({ term, ann }) => EB.Constructors.Annotation(call.term(subst, term, level), call.term(subst, ann, level)))
				.with({ type: "Match" }, ({ scrutinee, alternatives }) => {
					const countPatBinders = (pat: EB.Pattern): number => {
						return match(pat)
							.with({ type: "Var" }, _ => 1)
							.with({ type: "Binder" }, _ => 1)
							.with({ type: "Struct" }, ({ row }) =>
								R.fold(
									row,
									(val, _, tot) => countPatBinders(val) + tot,
									(_, tot) => tot + 1,
									0,
								),
							)
							.with({ type: "Variant" }, ({ row }) =>
								R.fold(
									row,
									(val, _, tot) => countPatBinders(val) + tot,
									(_, tot) => tot + 1,
									0,
								),
							)
							.with({ type: "Row" }, ({ row }) =>
								R.fold(
									row,
									(val, _, tot) => countPatBinders(val) + tot,
									(_, tot) => tot + 1,
									0,
								),
							)
							.otherwise(() => 0);
					};
					return EB.Constructors.Match(
						call.term(subst, scrutinee, level),
						alternatives.map(alt => ({ pattern: alt.pattern, term: call.term(subst, alt.term, level + countPatBinders(alt.pattern)) })),
					);
				})
				.with({ type: "Row" }, ({ row }) => {
					const r = R.traverse(
						row,
						val => call.term(subst, val, level),
						v => {
							if (v.type === "Meta" && subst[v.val]) {
								const tm = NF.quote(ctx.imports, ctx.env.length, subst[v.val]);

								if (tm.type === "Row") {
									return tm.row;
								}

								if (tm.type === "Var") {
									return R.Constructors.Variable(tm.variable);
								}

								throw new Error("Substitute: Row variable is not a row or a variable: " + EB.Display.Term(tm));
							}

							return R.Constructors.Variable(v);
						},
					);
					return EB.Constructors.Row(r);
				})
				.otherwise(() => {
					throw new Error("Substitute: Not implemented yet");
				});
		},
	};
};

export const display = (subst: Subst, separator = "\n"): string => {
	if (Object.keys(subst).length === 0) {
		return "empty";
	}
	return Object.entries(subst)
		.map(([key, value]) => `?${key} |=> ${NF.display(value)}`)
		.join(separator);
};

export const compose = (ctx: EB.Context, s1: Subst, s2: Subst, level = ctx.env.length): Subst => {
	const mapped = entries(s2).reduce((sub: Subst, [k, nf]) => ({ ...sub, [k]: Substitute(ctx).nf(s1, nf, level) }), {});
	return { ...s1, ...mapped };
};
