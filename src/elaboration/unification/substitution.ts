import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";

import * as R from "@yap/shared/rows";

import { match, P } from "ts-pattern";
import { entries, update } from "@yap/utils";

export type Subst = { [key: number]: NF.Value };

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
				.with(NF.Patterns.Label, () => val)
				.with(NF.Patterns.Rigid, () => val)
				.with(NF.Patterns.Flex, m => subst[m.variable.val] ?? update(m, "variable.ann", ann => call.nf(subst, ann, level)))
				.with(NF.Patterns.Var, v => v)
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
						(val): NF.Value => call.nf(subst, val, level),
						v => {
							if (v.type !== "Meta") {
								return R.Constructors.Variable(v);
							}
							const nf = subst[v.val];

							return match(nf)
								.with(P.nullish, (): NF.Row => R.Constructors.Variable(v))
								.with({ type: "Row" }, ({ row }) => row)
								.with({ type: "Var" }, ({ variable }): NF.Row => R.Constructors.Variable(variable))
								.otherwise(_ => {
									throw new Error("Substitute: Row variable is not a row or a variable: " + NF.display(nf));
								});
						},
					);
					return NF.Constructors.Row(r);
				})
				.otherwise(val => {
					throw new Error("Substitute: Not implemented yet: " + NF.display(val));
				});
		},

		closure: (subst: Subst, closure: NF.Closure): NF.Closure => ({
			ctx: closure.ctx,
			term: Substitute(ctx).term(subst, closure.term, closure.ctx.env.length + 1),
		}),
		term: (subst: Subst, term: EB.Term, level = ctx.env.length): EB.Term => {
			return match(term)
				.with({ type: "Lit" }, () => term)
				.with({ type: "Var", variable: { type: "Meta" } }, m =>
					subst[m.variable.val] ? NF.quote(ctx, level, subst[m.variable.val]) : update(m, "variable.ann", ann => call.nf(subst, ann, level)),
				)
				.with({ type: "Var" }, () => term)
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
							.with({ type: "Var" }, _ => 0) // NOTE: this is for defined variables, like in type patterns
							.with({ type: "Binder" }, _ => 1)
							.with({ type: "List" }, ({ patterns, rest }) => patterns.reduce((sum, p) => sum + countPatBinders(p), rest ? 1 : 0))
							.with({ type: "Struct" }, { type: "Variant" }, { type: "Row" }, ({ row }) =>
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
							if (v.type !== "Meta" || !subst[v.val]) {
								return R.Constructors.Variable(v);
							}

							const tm = NF.quote(ctx, ctx.env.length, subst[v.val]);
							return match(tm)
								.with({ type: "Row" }, ({ row }) => row)
								.with({ type: "Var" }, ({ variable }): EB.Row => R.Constructors.Variable(variable))
								.otherwise(_ => {
									throw new Error("Substitute: Row variable is not a row or a variable: " + EB.Display.Term(tm));
								});
						},
					);
					return EB.Constructors.Row(r);
				})
				.with({ type: "Block" }, ({ statements, return: ret }) => {
					const stmts = statements.map(s => {
						if (s.type === "Let") {
							return { ...s, value: call.term(subst, s.value, level), annotation: call.term(subst, s.annotation, level) };
						}
						return { ...s, value: call.term(subst, s.value, level) };
					});
					return EB.Constructors.Block(stmts, call.term(subst, ret, level));
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
