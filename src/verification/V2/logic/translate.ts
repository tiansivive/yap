import { match, P } from "ts-pattern";
import assert from "assert";
import type { Context as Z3Context, Sort, Expr, Bool, IntNum, SMTArray } from "z3-solver";

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
	operatorMap,
	PrimOps,
} from "@yap/shared/lib/primitives";

import type { VerificationRuntime } from "../utils/context";
import type { ExtractModalitiesFn } from "../utils/refinements";

export type TranslationTools = ReturnType<typeof createTranslationTools>;

export const createTranslationTools = (Z3: Z3Context<"main">, runtime: VerificationRuntime, toModalities: ExtractModalitiesFn) => {
	const Sorts = {
		Int: Z3.Int.sort(),
		Num: Z3.Real.sort(),
		Bool: Z3.Bool.sort(),
		String: Z3.Sort.declare("String"),
		Unit: Z3.Sort.declare("Unit"),
		Row: Z3.Sort.declare("Row"),
		Schema: Z3.Sort.declare("Schema"),
		Atom: Z3.Sort.declare("Atom"),
		Type: Z3.Sort.declare("Type"),
		Function: Z3.Sort.declare("Function"),
	};

	type SortMap = { Prim: Sort } | { Func: SortMap[] } | { App: SortMap[] } | { Row: Sort } | { Recursive: Sort };

	const build = (s: SortMap): Sort[] =>
		match(s)
			.with({ Prim: P.select() }, p => [p])
			.with({ App: P.select() }, ([f, a]) => build(f).concat(build(a)))
			.with({ Func: P.select() }, ([a, body]) => build(a).concat(build(body)))
			.with({ Row: P.select() }, r => [r])
			.with({ Recursive: P.select() }, r => [r])
			.exhaustive();

	const mkSort = (nf: NF.Value, ctx: EB.Context): SortMap =>
		match(nf)
			.with({ type: "Neutral" }, n => mkSort(n.value, ctx))
			.with({ type: "Modal" }, m => mkSort(m.value, ctx))
			.with(NF.Patterns.Lit, l =>
				match(l.value)
					.with({ type: "Atom" }, ({ value }) => {
						return { Prim: Sorts[value as keyof typeof Sorts] || Sorts.Atom };
					})
					.otherwise(() => {
						throw new Error("Unsupported literal in sort mapping");
					}),
			)
			.with(NF.Patterns.Row, () => ({ Row: Sorts.Row }))
			.with(NF.Patterns.Sigma, NF.Patterns.Schema, NF.Patterns.Variant, NF.Patterns.Indexed, () => ({ Row: Sorts.Schema }))
			.with(NF.Patterns.Mu, mu => ({ Recursive: Z3.Sort.declare(`Mu_${mu.binder.source}`) }))
			.with(NF.Patterns.Lambda, () => ({ Prim: Sorts.Function }))
			.with(NF.Patterns.App, ({ func, arg }) => ({ App: [mkSort(func, ctx), mkSort(arg, ctx)] }))
			.with({ type: "Abs" }, ({ binder, closure }) => {
				const body = NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length));
				return { Func: [mkSort(binder.annotation, ctx), mkSort(body, ctx)] };
			})
			.with({ type: "Existential" }, ex => mkSort(ex.body.value, EB.bind(ctx, { type: "Pi", variable: ex.variable }, ex.annotation)))
			.with({ type: "External" }, e => ({ Prim: Z3.Sort.declare(`External:${e.name}`) }))
			.with(NF.Patterns.Var, v => {
				if (v.variable.type === "Bound") {
					//return mkSort(ctx.env[EB.lvl2idx(ctx, v.variable.lvl)].nf, ctx);
					return mkSort(ctx.env[EB.lvl2idx(ctx, v.variable.lvl)].type[2], ctx);
				}
				if (v.variable.type === "Meta") {
					const ty = ctx.zonker[v.variable.val];
					if (!ty) {
						throw new Error("Unconstrained meta variable in verification");
					}
					return mkSort(ty, ctx);
				}
				return { Prim: Z3.Sort.declare(v.variable.name) };
			})
			.exhaustive();

	const collectArgs = (value: NF.Value, ctx: EB.Context, rigids: Record<number, Expr>): Expr[] =>
		match(value)
			.with(NF.Patterns.App, ({ func, arg }) => collectArgs(func, ctx, rigids).concat([translate(arg, ctx, rigids)]))
			.otherwise(() => [translate(value, ctx, rigids)]);

	const mkFunction = (val: NF.Value, ctx: EB.Context): SMTArray<"main", [Sort<"main">, ...Sort<"main">[]], Sort<"main">> =>
		match(val)
			.with(NF.Patterns.Var, ({ variable }) => {
				const get = () => {
					if (variable.type === "Bound") {
						const entry = ctx.env[EB.lvl2idx(ctx, variable.lvl)];
						return { name: entry.name.variable, type: entry.nf };
					}
					if (variable.type === "Free") {
						const [, type] = ctx.imports[variable.name];
						return { name: variable.name, type };
					}
					if (variable.type === "Foreign") {
						if (!(variable.name in PrimOps)) {
							throw new Error("Foreign variable not supported in logical formulas");
						}
						const [, type] = ctx.imports[operatorMap[variable.name]];
						return { name: variable.name, type };
					}
					throw new Error("Unsupported variable type in mkFunction");
				};
				const { name, type } = get();
				const sorts = build(mkSort(type, ctx)) as [Sort, ...Sort[], Sort];
				return Z3.Array.const(name, ...sorts);
			})
			.with(NF.Patterns.App, a => mkFunction(a.func, ctx))
			.with({ type: "External" }, e => {
				const args = e.args.flatMap(arg => build(mkSort(arg, ctx))) as [Sort, ...Sort[], Sort];
				return Z3.Array.const(e.name, ...args);
			})
			.otherwise(() => {
				throw new Error("Not a function");
			});

	const translate = (nf: NF.Value, ctx: EB.Context, rigids: Record<number, Expr> = {}): Expr =>
		match(nf)
			.with({ type: "Neutral" }, n => translate(n.value, ctx, rigids))
			.with({ type: "Modal" }, m => translate(m.value, ctx, rigids))
			.with(NF.Patterns.Lit, l =>
				match(l.value)
					.with({ type: "Num" }, lit => Z3.Real.val(lit.value))
					.with({ type: "Bool" }, lit => Z3.Bool.val(lit.value))
					.with({ type: "String" }, lit => Z3.Const(lit.value, Sorts.String))
					.with({ type: "unit" }, () => Z3.Const("unit", Sorts.Unit))
					.with(
						{ type: "Atom" },
						({ value }) => ["Num", "String", "Bool", "Unit", "Type", "Row"].includes(value),
						atom => Z3.Const(atom.value, Sorts.Type),
					)
					.otherwise(() => {
						throw new Error("Unsupported literal in logical formulas");
					}),
			)
			.with(NF.Patterns.Row, () => {
				throw new Error("Row literals not supported yet");
			})
			.with({ type: "Abs" }, () => {
				throw new Error("Function literals not supported in logical formulas");
			})
			.with(NF.Patterns.App, fn => {
				const f = mkFunction(fn.func, ctx);
				const [, ...args] = collectArgs(fn, ctx, rigids);
				return f.select(args[0], ...args.slice(1));
			})
			.with(NF.Patterns.Var, v => {
				if (v.variable.type === "Bound") {
					const mapped = rigids[v.variable.lvl];
					if (mapped) {
						return mapped;
					}
					const entry = ctx.env[EB.lvl2idx(ctx, v.variable.lvl)];
					const sorts = build(mkSort(entry.type[2], ctx));
					const sort = sorts.length === 1 ? sorts[0] : Z3.Sort.declare(`App_${sorts.map(s => s.name()).join("_")}`);
					return Z3.Const(entry.name.variable, sort);
				}
				if (v.variable.type === "Free") {
					const [term] = ctx.imports[v.variable.name];
					return translate(NF.evaluate(ctx, term), ctx, rigids);
				}
				throw new Error("Unsupported variable in translation");
			})
			.with({ type: "External" }, e => {
				if (e.args.length !== e.arity) {
					throw new Error("External with wrong arity in logical formulas");
				}
				const args = e.args.map(arg => translate(arg, ctx, rigids));
				return match(e.name)
					.with(OP_ADD, () => (args[0] as IntNum).add(args[1] as IntNum))
					.with(OP_SUB, () => (args[0] as IntNum).sub(args[1] as IntNum))
					.with(OP_MUL, () => (args[0] as IntNum).mul(args[1] as IntNum))
					.with(OP_DIV, () => (args[0] as IntNum).div(args[1] as IntNum))
					.with(OP_AND, () => Z3.And(args[0] as Bool, args[1] as Bool))
					.with(OP_OR, () => Z3.Or(args[0] as Bool, args[1] as Bool))
					.with(OP_NOT, () => (args[0] as Bool).not())
					.with(OP_EQ, () => args[0].eq(args[1]))
					.with(OP_NEQ, () => args[0].neq(args[1]))
					.with(OP_GT, () => (args[0] as IntNum).gt(args[1] as IntNum))
					.with(OP_GTE, () => (args[0] as IntNum).ge(args[1] as IntNum))
					.with(OP_LT, () => (args[0] as IntNum).lt(args[1] as IntNum))
					.with(OP_LTE, () => (args[0] as IntNum).le(args[1] as IntNum))
					.otherwise(name => {
						throw new Error(`Unknown external function in logical formulas: ${name}`);
					});
			})
			.otherwise(() => {
				throw new Error("Unknown expression type");
			});

	const quantify = (variable: string, annotation: NF.Value, vc: Expr, ctx: EB.Context): Expr =>
		match(annotation)
			.with({ type: "Existential" }, ex => {
				const c = quantify(variable, ex.body.value, vc, EB.bind(ex.body.ctx, { type: "Pi", variable: ex.variable }, ex.annotation));
				return quantify(ex.variable, ex.annotation, c, ctx);
			})
			.with(NF.Patterns.Pi, () => vc)
			.otherwise(() => {
				const sortMap = mkSort(annotation, ctx);
				const xSort = match(sortMap)
					.with({ Prim: P.select() }, p => p)
					.with({ Recursive: P.select() }, r => r)
					.with({ Row: P.select() }, r => r)
					.with({ App: P._ }, app => {
						const sorts = build(app);
						return Z3.Sort.declare(`App_${sorts.map(s => s.name()).join("_")}`);
					})
					.otherwise(() => {
						throw new Error("Unknown sort in logical formulas");
					});

				const x = Z3.Const(variable, xSort);
				if (annotation.type !== "Modal") {
					return runtime.record(`quantify:${variable}`, Z3.ForAll([x], vc as Bool), {
						description: `Quantifying over ${variable} with ${NF.display(annotation, ctx)}`,
					});
				}

				const modalities = toModalities(annotation, ctx);
				assert(modalities.liquid.type === "Abs", "Liquid refinements must be unary functions");
				const lvl = ctx.env.length;
				const applied = NF.apply(modalities.liquid.binder, modalities.liquid.closure, NF.Constructors.Rigid(lvl));
				const rigids = { [lvl]: x } as Record<number, Expr>;
				const phi = translate(applied, ctx, rigids) as Bool;
				return runtime.record(`quantify:${variable}`, Z3.ForAll([x], Z3.Implies(phi, vc as Bool)) as Bool, { description: `Quantifying refined ${variable}` });
			});

	return {
		Sorts,
		mkSort,
		build,
		translate,
		mkFunction,
		quantify,
	};
};

export type SortMap = ReturnType<ReturnType<typeof createTranslationTools>["mkSort"]>;
