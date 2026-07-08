import { match } from "ts-pattern";
import assert from "assert";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

import {
	OP_ADD,
	OP_AND,
	OP_DIV,
	OP_EQ,
	OP_GT,
	OP_GTE,
	OP_LT,
	OP_LTE,
	OP_MUL,
	OP_NEQ,
	OP_NOT,
	OP_OR,
	OP_SUB,
	primopMapping,
	PrimOps,
} from "@yap/shared/lib/primitives";

import type { IVL } from "../../solver/ivl/types";
import { Build } from "../../solver/ivl/build";
import type { VerificationRuntime } from "../utils/context";
import type { ExtractModalitiesFn } from "../utils/refinements";

export type TranslationTools = ReturnType<typeof createTranslationTools>;

export const createTranslationTools = (runtime: VerificationRuntime, toModalities: ExtractModalitiesFn) => {
	const mkSort = (nf: NF.Value, ctx: EB.Context): IVL.Sort =>
		match(nf)
			.with({ type: "Neutral" }, n => mkSort(n.value, ctx))
			.with({ type: "Modal" }, m => mkSort(m.value, ctx))
			.with(NF.Patterns.Lit, l =>
				match(l.value)
					.with({ type: "Atom" }, ({ value }) => {
						const map: Record<string, IVL.Sort> = {
							Num: Build.Real,
							Int: Build.Int,
							Bool: Build.Bool,
							String: Build.String,
							Unit: Build.Unit,
							Type: Build.uninterpreted("Type"),
							Row: Build.Row,
						};
						return map[value] ?? Build.uninterpreted(value);
					})
					.otherwise(() => {
						throw new Error("Unsupported literal in sort mapping");
					}),
			)
			.with(NF.Patterns.Row, () => Build.Row)
			.with(NF.Patterns.Sigma, NF.Patterns.Schema, NF.Patterns.Variant, NF.Patterns.Indexed, () => Build.uninterpreted("Schema"))
			.with(NF.Patterns.Mu, mu => Build.uninterpreted(`Mu_${mu.binder.source}`))
			.with(NF.Patterns.Lambda, () => Build.uninterpreted("Function"))
			.with(NF.Patterns.App, ({ func, arg }) => {
				const fSort = mkSort(func, ctx);
				const aSort = mkSort(arg, ctx);
				return Build.uninterpreted(`App_${sortName(fSort)}_${sortName(aSort)}`);
			})
			.with({ type: "Abs" }, ({ binder, closure }) => {
				const body = NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length));
				const argSort = mkSort(binder.annotation, ctx);
				const retSort = mkSort(body, ctx);
				return Build.fn([argSort], retSort);
			})
			.with({ type: "Existential" }, ex => mkSort(ex.body.value, EB.bind(ctx, { type: "Pi", variable: ex.variable }, ex.annotation)))
			.with({ type: "External" }, e => Build.uninterpreted(`External:${e.name}`))
			.with(NF.Patterns.Var, v => {
				if (v.variable.type === "Bound") {
					return mkSort(ctx.env[EB.lvl2idx(ctx, v.variable.lvl)].type[2], ctx);
				}
				if (v.variable.type === "Meta") {
					const ty = ctx.zonker[v.variable.val];
					if (!ty) {
						throw new Error("Unconstrained meta variable in verification");
					}
					return mkSort(ty, ctx);
				}
				return Build.uninterpreted(v.variable.name);
			})
			.otherwise(() => {
				throw new Error("Unsupported NF.Value in verification sort mapping");
			});

	const getFnSorts = (value: NF.Value, ctx: EB.Context): { name: string; args: IVL.Sort[]; ret: IVL.Sort } => {
		const getName = (val: NF.Value): string =>
			match(NF.unwrapNeutral(val))
				.with(NF.Patterns.Var, ({ variable }) => {
					if (variable.type === "Bound") {
						const entry = ctx.env[EB.lvl2idx(ctx, variable.lvl)];
						return entry.name.variable;
					}

					if (variable.type === "Free") {
						return variable.name;
					}

					if (variable.type === "Foreign") {
						return variable.name;
					}
					throw new Error("Unsupported variable type in getFnSorts");
				})
				.with({ type: "External" }, e => e.name)
				.with(NF.Patterns.App, a => getName(a.func))
				.otherwise(() => {
					throw new Error("Not a function");
				});

		const getType = (val: NF.Value): NF.Value =>
			match(NF.unwrapNeutral(val))
				.with(NF.Patterns.Var, ({ variable }) => {
					if (variable.type === "Bound") {
						const entry = ctx.env[EB.lvl2idx(ctx, variable.lvl)];
						return entry.type[2];
					}
					if (variable.type === "Free") {
						const [, type] = ctx.imports[variable.name];
						return type;
					}
					if (variable.type === "Foreign") {
						if (!(variable.name in PrimOps)) {
							throw new Error("Foreign variable not supported in logical formulas");
						}
						const [, type] = ctx.imports[primopMapping[variable.name]];
						return type;
					}
					throw new Error("Unsupported variable type in getFnSorts");
				})
				.with({ type: "External" }, e => {
					// External nodes are fully applied — they carry their own args and are
					// dispatched directly in `term` and `formula`, never via getFnSorts.
					throw new Error(`getType reached External "${e.name}" — this node should be handled before getFnSorts`);
				})
				.with(NF.Patterns.App, a => getType(a.func))
				.otherwise(() => {
					throw new Error("Not a function");
				});

		const name = getName(value);
		const sort = mkSort(getType(value), ctx);

		const collectFnSorts = (s: IVL.Sort): { args: IVL.Sort[]; ret: IVL.Sort } =>
			match(s)
				.with({ tag: "Fn" }, ({ args, ret }) => ({ args, ret }))
				.otherwise(s => ({ args: [], ret: s }));

		const { args, ret } = collectFnSorts(sort);
		return { name, args, ret };
	};

	const collectArgs = (value: NF.Value, ctx: EB.Context, rigids: Record<number, IVL.Term>): IVL.Term[] =>
		match(value)
			.with(NF.Patterns.App, ({ func, arg }) => collectArgs(func, ctx, rigids).concat([term(arg, ctx, rigids)]))
			.otherwise(() => []);

	const term = (nf: NF.Value, ctx: EB.Context, rigids: Record<number, IVL.Term> = {}): IVL.Term =>
		match(nf)
			.with({ type: "Neutral" }, ({ value }) => term(value, ctx, rigids))
			.with({ type: "Modal" }, ({ value }) => term(value, ctx, rigids))
			.with(NF.Patterns.Lit, l =>
				match(l.value)
					.with({ type: "Num" }, lit => Build.num(lit.value, Build.Real))
					.with({ type: "Bool" }, lit => Build.bool(lit.value))
					.with({ type: "String" }, lit => Build.str(lit.value))
					.with({ type: "unit" }, () => Build.const_("unit", Build.Unit))
					.with(
						{ type: "Atom" },
						({ value }) => ["Num", "String", "Bool", "Unit", "Type", "Row"].includes(value),
						atom => Build.const_(atom.value, Build.uninterpreted("Type")),
					)
					.otherwise(() => {
						throw new Error("Unsupported literal in logical formulas");
					}),
			)
			.with(NF.Patterns.App, fn => {
				const { name, args: argSorts, ret } = getFnSorts(fn, ctx);
				const args = collectArgs(fn, ctx, rigids);

				if (args.length === 0) {
					return Build.const_(name, ret);
				}
				const fnSort = Build.fn(argSorts, ret);
				const fnTerm = Build.const_(name, fnSort);
				return Build.select(fnTerm, args[0], ret);
			})
			.with(NF.Patterns.Var, v => {
				if (v.variable.type === "Bound") {
					const mapped = rigids[v.variable.lvl];

					if (mapped) {
						return mapped;
					}
					const entry = ctx.env[EB.lvl2idx(ctx, v.variable.lvl)];
					const sort = mkSort(entry.type[2], ctx);
					return Build.const_(entry.name.variable, sort);
				}
				if (v.variable.type === "Free") {
					const [t] = ctx.imports[v.variable.name];
					return term(NF.evaluate(ctx, t), ctx, rigids);
				}
				if (v.variable.type === "Meta") {
					return Build.const_(`?${v.variable.val}`, Build.uninterpreted("Any"));
				}
				if (v.variable.type === "Label") {
					const name = v.variable.name;
					const sig = ctx.sigma[name];
					// A concrete sibling value (threaded in by the enclosing record boundary) resolves
					// directly. A purely symbolic sibling — the label-neutral placeholder installed by
					// `withRowLabels`, or nothing in scope — becomes a logical constant of the field's sort.
					if (sig) {
						const symbolic = match(sig.value)
							.with({ type: "Neutral", value: { type: "Var", variable: { type: "Label" } } }, () => true)
							.otherwise(() => false);
						if (!symbolic) {
							return term(sig.value, ctx, rigids);
						}
					}
					const ty = ctx.labels[name];
					return Build.const_(name, ty ? mkSort(ty, ctx) : Build.uninterpreted("Label"));
				}
				throw new Error(`Unsupported variable in formula translation: ${v.variable.type} (${JSON.stringify(v.variable)})`);
			})
			.with({ type: "External" }, e => {
				if (e.args.length !== e.arity) {
					throw new Error("External with wrong arity in logical formulas");
				}
				const args = e.args.map(arg => term(arg, ctx, rigids));
				return match(e.name)
					.with(OP_ADD, () => Build.arith("+", args[0], args[1], Build.Real))
					.with(OP_SUB, () => Build.arith("-", args[0], args[1], Build.Real))
					.with(OP_MUL, () => Build.arith("*", args[0], args[1], Build.Real))
					.with(OP_DIV, () => Build.arith("/", args[0], args[1], Build.Real))
					.otherwise(() => Build.const_(`__external_${e.name}`, Build.Bool));
			})
			.otherwise(() => {
				throw new Error("Unsupported expression type in verification");
			});

	const formula = (nf: NF.Value, ctx: EB.Context, rigids: Record<number, IVL.Term> = {}): IVL.Formula =>
		match(nf)
			.with({ type: "Neutral" }, ({ value }) => formula(value, ctx, rigids))
			.with({ type: "Modal" }, ({ value }) => formula(value, ctx, rigids))
			.with(NF.Patterns.Lit, ({ value }) =>
				match(value)
					.with({ type: "Bool" }, ({ value }) => (value ? Build.true_() : Build.false_()))
					.otherwise(() => Build.atom("=", term(nf, ctx, rigids), Build.bool(true))),
			)
			.with({ type: "External" }, ({ name, args }) =>
				match(name)
					.with(OP_AND, () => Build.and(formula(args[0], ctx, rigids), formula(args[1], ctx, rigids)))
					.with(OP_OR, () => Build.or(formula(args[0], ctx, rigids), formula(args[1], ctx, rigids)))
					.with(OP_NOT, () => Build.not(formula(args[0], ctx, rigids)))
					.with(OP_EQ, () => Build.atom("=", term(args[0], ctx, rigids), term(args[1], ctx, rigids)))
					.with(OP_NEQ, () => Build.atom("!=", term(args[0], ctx, rigids), term(args[1], ctx, rigids)))
					.with(OP_GT, () => Build.atom(">", term(args[0], ctx, rigids), term(args[1], ctx, rigids)))
					.with(OP_GTE, () => Build.atom(">=", term(args[0], ctx, rigids), term(args[1], ctx, rigids)))
					.with(OP_LT, () => Build.atom("<", term(args[0], ctx, rigids), term(args[1], ctx, rigids)))
					.with(OP_LTE, () => Build.atom("<=", term(args[0], ctx, rigids), term(args[1], ctx, rigids)))
					.otherwise(() => Build.atom("=", term(nf, ctx, rigids), Build.bool(true))),
			)
			.otherwise(() => Build.atom("=", term(nf, ctx, rigids), Build.bool(true)));

	const quantify = (variable: string, annotation: NF.Value, vc: IVL.Formula, ctx: EB.Context): IVL.Formula =>
		match(annotation)
			.with({ type: "Existential" }, ex => {
				const c = quantify(variable, ex.body.value, vc, EB.bind(ex.body.ctx, { type: "Pi", variable: ex.variable }, ex.annotation));
				return quantify(ex.variable, ex.annotation, c, ctx);
			})
			.with(NF.Patterns.Pi, () => vc)
			.otherwise(() => {
				const sort = mkSort(annotation, ctx);
				const x = Build.var_(variable, sort);

				if (annotation.type !== "Modal") {
					return runtime.record(`quantify:${variable}`, Build.forall([{ name: variable, sort }], vc), {
						description: `Quantifying over ${variable} with ${NF.display(annotation, ctx)}`,
					});
				}

				const modalities = toModalities(annotation, ctx);
				assert(modalities.liquid.type === "Abs", "Liquid refinements must be unary functions");
				const lvl = ctx.env.length;
				const applied = NF.apply(modalities.liquid.binder, modalities.liquid.closure, NF.Constructors.Rigid(lvl));
				const rigids = { [lvl]: x } as Record<number, IVL.Term>;
				const phi = formula(applied, ctx, rigids);
				return runtime.record(`quantify:${variable}`, Build.forall([{ name: variable, sort }], Build.implies(phi, vc)), {
					description: `Quantifying refined ${variable}`,
				});
			});

	return {
		mkSort,
		term,
		formula,
		quantify,
	};
};

const sortName = (s: IVL.Sort): string =>
	match(s)
		.with({ tag: "Bool" }, () => "Bool")
		.with({ tag: "Int" }, () => "Int")
		.with({ tag: "Real" }, () => "Real")
		.with({ tag: "String" }, () => "String")
		.with({ tag: "Unit" }, () => "Unit")
		.with({ tag: "Row" }, () => "Row")
		.with({ tag: "Fn" }, ({ args, ret }) => `Fn_${args.map(sortName).join("_")}_${sortName(ret)}`)
		.with({ tag: "Uninterpreted" }, ({ name }) => name)
		.exhaustive();
