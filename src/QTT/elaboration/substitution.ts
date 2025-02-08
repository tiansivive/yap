import * as NF from "@qtt/elaboration/normalization";
import * as EB from "@qtt/elaboration";

import * as R from "@qtt/shared/rows";

import { match } from "ts-pattern";

export type Subst = { [key: number]: NF.Value };

export const Substitute = (ctx: EB.Context) => {
	const call = {
		nf: (subst: Subst, val: NF.Value): NF.Value => Substitute(ctx).nf(subst, val),
		closure: (subst: Subst, closure: NF.Closure): NF.Closure => Substitute(ctx).closure(subst, closure),
		term: (subst: Subst, term: EB.Term): EB.Term => Substitute(ctx).term(subst, term),
	};

	return {
		nf: (subst: Subst, val: NF.Value): NF.Value =>
			match(val)
				.with(NF.Patterns.Lit, () => val)
				.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(call.nf(subst, value)))
				.with(NF.Patterns.Flex, ({ variable }) => subst[variable.index] ?? val)
				.with(NF.Patterns.Lambda, ({ binder, closure }) => NF.Constructors.Lambda(binder.variable, binder.icit, call.closure(subst, closure)))
				.with(NF.Patterns.Pi, ({ closure, binder }) =>
					NF.Constructors.Pi(binder.variable, binder.icit, [call.nf(subst, binder.annotation[0]), binder.annotation[1]], call.closure(subst, closure)),
				)

				.with(NF.Patterns.App, ({ func, arg, icit }) => NF.Constructors.App(call.nf(subst, func), call.nf(subst, arg), icit))
				.with(NF.Patterns.Row, ({ row }) => {
					const r = R.traverse(
						row,
						val => call.nf(subst, val),
						v => {
							if (v.type === "Meta") {
								const nf = subst[v.index];

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

				.otherwise(() => {
					throw new Error("Substitute: Not implemented yet");
				}),

		closure: (subst: Subst, closure: NF.Closure): NF.Closure => ({
			env: closure.env,
			term: call.term(subst, closure.term),
		}),
		term: (subst: Subst, term: EB.Term): EB.Term =>
			match(term)
				.with({ type: "Lit" }, () => term)
				.with({ type: "Var" }, ({ variable }) => {
					if (variable.type === "Meta") {
						return subst[variable.index] ? NF.quote(ctx.imports, ctx.env.length, subst[variable.index]) : term;
					}

					return term;
				})
				.with({ type: "Abs" }, ({ binding, body }) => EB.Constructors.Abs(binding, call.term(subst, body)))
				.with({ type: "App" }, ({ func, arg, icit }) => EB.Constructors.App(icit, call.term(subst, func), call.term(subst, arg)))
				.with({ type: "Proj" }, ({ label, term }) => EB.Constructors.Proj(label, call.term(subst, term)))
				.with({ type: "Inj" }, ({ label, value, term }) => EB.Constructors.Inj(label, call.term(subst, value), call.term(subst, term)))
				.with({ type: "Annotation" }, ({ term, ann }) => EB.Constructors.Annotation(call.term(subst, term), call.term(subst, ann)))
				.with({ type: "Match" }, ({ scrutinee, alternatives }) =>
					EB.Constructors.Match(
						call.term(subst, scrutinee),
						alternatives.map(alt => ({ pattern: alt.pattern, term: call.term(subst, alt.term) })),
					),
				)
				.with({ type: "Row" }, ({ row }) => {
					const r = R.traverse(
						row,
						val => call.term(subst, val),
						v => {
							if (v.type === "Meta") {
								const tm = NF.quote(ctx.imports, ctx.env.length, subst[v.index]);

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
				}),
	};
};

export const display = (subst: Subst): string => {
	return Object.entries(subst)
		.map(([key, value]) => `?${key} |=> ${NF.display(value)}`)
		.join("\n");
};
