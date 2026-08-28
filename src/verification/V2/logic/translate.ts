import { match } from "ts-pattern";
import assert from "assert";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";

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
import { extractModalities } from "../utils/refinements";
import { reader, obligations, type Verification } from "../effects";

export const mkSort = function* (nf: NF.Value): Verification<IVL.Sort> {
	const ctx = yield* reader.ask();
	return yield* match(nf)
		.with({ type: "Neutral" }, function* (n) {
			return yield* mkSort(n.value);
		})
		.with({ type: "Modal" }, function* (m) {
			return yield* mkSort(m.value);
		})
		.with(NF.Patterns.Lit, function* (l) {
			return match(l.value)
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
				});
		})
		.with(NF.Patterns.Row, function* () {
			return Build.Row;
		})
		.with(NF.Patterns.Sigma, NF.Patterns.Schema, NF.Patterns.Variant, NF.Patterns.Indexed, function* () {
			return Build.uninterpreted("Schema");
		})
		.with(NF.Patterns.Mu, function* (mu) {
			return Build.uninterpreted(`Mu_${mu.binder.source}`);
		})
		.with(NF.Patterns.Lambda, function* () {
			return Build.uninterpreted("Function");
		})
		.with(NF.Patterns.App, function* ({ func, arg }) {
			const fSort = yield* mkSort(func);
			const aSort = yield* mkSort(arg);
			return Build.uninterpreted(`App_${sortName(fSort)}_${sortName(aSort)}`);
		})
		.with({ type: "Abs" }, function* ({ binder, closure }) {
			const body = yield* NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length));
			const argSort = yield* mkSort(binder.annotation);
			const retSort = yield* mkSort(body);
			return Build.fn([argSort], retSort);
		})
		.with({ type: "Existential" }, function* (ex) {
			return yield* reader.local(() => EB.bind(ctx, { type: "Pi", variable: ex.variable }, ex.annotation), mkSort(ex.body.value));
		})
		.with({ type: "External" }, function* (e) {
			return Build.uninterpreted(`External:${e.name}`);
		})
		.with(NF.Patterns.Var, function* (v) {
			if (v.variable.type === "Bound") {
				return yield* mkSort(ctx.env[EB.lvl2idx(ctx, v.variable.lvl)].type[2]);
			}
			if (v.variable.type === "Meta") {
				const registry = yield* Metas.registry.get();
				const ty = Metas.solution(registry, v.variable.val);
				if (!ty) {
					throw new Error("Unconstrained meta variable in verification");
				}
				return yield* mkSort(ty);
			}
			return Build.uninterpreted(v.variable.name);
		})
		.otherwise(function* () {
			throw new Error("Unsupported NF.Value in verification sort mapping");
		});
};

const getFnSorts = function* (value: NF.Value): Verification<{ name: string; args: IVL.Sort[]; ret: IVL.Sort }> {
	const ctx = yield* reader.ask();

	const getName = (val: NF.Value): string =>
		match(NF.unwrapNeutral(val))
			.with(NF.Patterns.Var, ({ variable }) => {
				if (variable.type === "Bound") {
					return ctx.env[EB.lvl2idx(ctx, variable.lvl)].name.variable;
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
					return ctx.env[EB.lvl2idx(ctx, variable.lvl)].type[2];
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
	const sort = yield* mkSort(getType(value));

	const collectFnSorts = (s: IVL.Sort): { args: IVL.Sort[]; ret: IVL.Sort } =>
		match(s)
			.with({ tag: "Fn" }, ({ args, ret }) => ({ args, ret }))
			.otherwise(s => ({ args: [], ret: s }));

	const { args, ret } = collectFnSorts(sort);
	return { name, args, ret };
};

const collectArgs = function* (value: NF.Value, rigids: Record<number, IVL.Term>): Verification<IVL.Term[]> {
	return yield* match(value)
		.with(NF.Patterns.App, function* ({ func, arg }) {
			const head = yield* collectArgs(func, rigids);
			const translated = yield* term(arg, rigids);
			return [...head, translated];
		})
		.otherwise(function* () {
			return [] as IVL.Term[];
		});
};

export const term = function* (nf: NF.Value, rigids: Record<number, IVL.Term> = {}): Verification<IVL.Term> {
	const ctx = yield* reader.ask();
	const forced = yield* NF.force(nf);
	return yield* match(forced)
		.with({ type: "Neutral" }, function* ({ value }) {
			return yield* term(value, rigids);
		})
		.with({ type: "Modal" }, function* ({ value }) {
			return yield* term(value, rigids);
		})
		.with(NF.Patterns.Lit, function* (l) {
			return match(l.value)
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
				});
		})
		.with(NF.Patterns.App, function* (fn) {
			const { name, args: argSorts, ret } = yield* getFnSorts(fn);
			const args = yield* collectArgs(fn, rigids);

			if (args.length === 0) {
				return Build.const_(name, ret);
			}
			const fnSort = Build.fn(argSorts, ret);
			const fnTerm = Build.const_(name, fnSort);
			return Build.select(fnTerm, args[0], ret);
		})
		.with(NF.Patterns.Var, function* (v) {
			if (v.variable.type === "Bound") {
				const mapped = rigids[v.variable.lvl];
				if (mapped) {
					return mapped;
				}
				const entry = ctx.env[EB.lvl2idx(ctx, v.variable.lvl)];
				const sort = yield* mkSort(entry.type[2]);
				return Build.const_(entry.name.variable, sort);
			}
			if (v.variable.type === "Free") {
				const [t] = ctx.imports[v.variable.name];
				const evaluated = yield* NF.evaluate(t);
				return yield* term(evaluated, rigids);
			}
			if (v.variable.type === "Meta") {
				return Build.const_(`?${v.variable.val}`, Build.uninterpreted("Any"));
			}
			if (v.variable.type === "Label") {
				const name = v.variable.name;
				const sig = ctx.sigma[name];
				if (sig) {
					const symbolic = match(sig.value)
						.with({ type: "Neutral", kind: "Symbolic", value: { type: "Var", variable: { type: "Label" } } }, () => true)
						.otherwise(() => false);
					if (!symbolic) {
						return yield* term(sig.value, rigids);
					}
				}
				const ty = ctx.labels[name];
				const sort = ty ? yield* mkSort(ty) : Build.uninterpreted("Label");
				return Build.const_(name, sort);
			}
			throw new Error(`Unsupported variable in formula translation: ${v.variable.type} (${JSON.stringify(v.variable)})`);
		})
		.with({ type: "External" }, function* (e) {
			if (e.args.length !== e.arity) {
				throw new Error("External with wrong arity in logical formulas");
			}
			const args: IVL.Term[] = [];
			for (const arg of e.args) {
				args.push(yield* term(arg, rigids));
			}
			return match(e.name)
				.with(OP_ADD, () => Build.arith("+", args[0], args[1], Build.Real))
				.with(OP_SUB, () => Build.arith("-", args[0], args[1], Build.Real))
				.with(OP_MUL, () => Build.arith("*", args[0], args[1], Build.Real))
				.with(OP_DIV, () => Build.arith("/", args[0], args[1], Build.Real))
				.otherwise(() => Build.const_(`__external_${e.name}`, Build.Bool));
		})
		.otherwise(function* () {
			throw new Error("Unsupported expression type in verification");
		});
};

export const formula = function* (nf: NF.Value, rigids: Record<number, IVL.Term> = {}): Verification<IVL.Formula> {
	const forced = yield* NF.force(nf);
	return yield* match(forced)
		.with({ type: "Neutral" }, function* ({ value }) {
			return yield* formula(value, rigids);
		})
		.with({ type: "Modal" }, function* ({ value }) {
			return yield* formula(value, rigids);
		})
		.with(NF.Patterns.Lit, function* ({ value }) {
			if (value.type === "Bool") {
				return value.value ? Build.true_() : Build.false_();
			}
			return Build.atom("=", yield* term(nf, rigids), Build.bool(true));
		})
		.with({ type: "External" }, function* ({ name, args }) {
			return yield* match(name)
				.with(OP_AND, function* () {
					return Build.and(yield* formula(args[0], rigids), yield* formula(args[1], rigids));
				})
				.with(OP_OR, function* () {
					return Build.or(yield* formula(args[0], rigids), yield* formula(args[1], rigids));
				})
				.with(OP_NOT, function* () {
					return Build.not(yield* formula(args[0], rigids));
				})
				.with(OP_EQ, function* () {
					return Build.atom("=", yield* term(args[0], rigids), yield* term(args[1], rigids));
				})
				.with(OP_NEQ, function* () {
					return Build.atom("!=", yield* term(args[0], rigids), yield* term(args[1], rigids));
				})
				.with(OP_GT, function* () {
					return Build.atom(">", yield* term(args[0], rigids), yield* term(args[1], rigids));
				})
				.with(OP_GTE, function* () {
					return Build.atom(">=", yield* term(args[0], rigids), yield* term(args[1], rigids));
				})
				.with(OP_LT, function* () {
					return Build.atom("<", yield* term(args[0], rigids), yield* term(args[1], rigids));
				})
				.with(OP_LTE, function* () {
					return Build.atom("<=", yield* term(args[0], rigids), yield* term(args[1], rigids));
				})
				.otherwise(function* () {
					return Build.atom("=", yield* term(nf, rigids), Build.bool(true));
				});
		})
		.otherwise(function* () {
			return Build.atom("=", yield* term(nf, rigids), Build.bool(true));
		});
};

export const quantify = function* (variable: string, annotation: NF.Value, vc: IVL.Formula): Verification<IVL.Formula> {
	const ctx = yield* reader.ask();
	return yield* match(annotation)
		.with({ type: "Existential" }, function* (ex) {
			const inner = yield* reader.local(
				() => EB.bind(ex.body.ctx, { type: "Pi", variable: ex.variable }, ex.annotation),
				quantify(variable, ex.body.value, vc),
			);
			return yield* quantify(ex.variable, ex.annotation, inner);
		})
		.with(NF.Patterns.Pi, function* () {
			return vc;
		})
		.otherwise(function* () {
			const sort = yield* mkSort(annotation);
			const x = Build.var_(variable, sort);

			if (annotation.type !== "Modal") {
				return yield* obligations.record(`quantify:${variable}`, Build.forall([{ name: variable, sort }], vc), {
					description: `Quantifying over ${variable}`,
				});
			}

			const modalities = extractModalities(annotation, ctx);
			assert(modalities.liquid.type === "Abs", "Liquid refinements must be unary functions");
			const lvl = ctx.env.length;
			const applied = yield* NF.apply(modalities.liquid.binder, modalities.liquid.closure, NF.Constructors.Rigid(lvl));
			const rigids = { [lvl]: x } as Record<number, IVL.Term>;
			const phi = yield* formula(applied, rigids);
			return yield* obligations.record(`quantify:${variable}`, Build.forall([{ name: variable, sort }], Build.implies(phi, vc)), {
				description: `Quantifying refined ${variable}`,
			});
		});
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
