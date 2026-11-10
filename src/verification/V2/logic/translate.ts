import { match, P } from "ts-pattern";
import assert from "assert";

import * as Eff from "@yap/utils/effects";

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
import { reader, obligations, names, supply, type Verification } from "../effects";

const BooleanExternal = { ...NF.Patterns.External, name: P.union(OP_EQ, OP_NEQ, OP_LT, OP_GT, OP_LTE, OP_GTE, OP_AND, OP_OR, OP_NOT) } as const;

export const mkSort = function* (nf: NF.Value): Verification<IVL.Sort> {
	const ctx = yield* reader.ask();
	const { value: structure } = yield* NF.view(nf);
	return yield* match(structure)
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
		.with(NF.Patterns.Sigma, NF.Patterns.SigmaV2, NF.Patterns.Nu, NF.Patterns.Schema, NF.Patterns.Variant, NF.Patterns.Indexed, function* () {
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
			const retSort = yield* scope(yield* supply.freshFrom(binder.variable), binder, binder.annotation, mkSort(body));
			return Build.fn([argSort], retSort);
		})
		.with({ type: "Existential" }, function* (ex) {
			return yield* reader.local(
				() => ex.body.ctx,
				scope(yield* supply.freshFrom(ex.variable), { type: "Pi", variable: ex.variable }, ex.annotation, mkSort(ex.body.value)),
			);
		})
		.with({ type: "External" }, function* (e) {
			return Build.uninterpreted(`External:${e.name}`);
		})
		.with(NF.Patterns.DepLabel, NF.Patterns.NuLabel, ({ variable }) => mkSort(variable.annotation))
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

const getFnSorts = function* (value: NF.Value): Verification<{ head: IVL.Term; ret: IVL.Sort }> {
	const ctx = yield* reader.ask();
	const bound = yield* names.ask();

	const head = (val: NF.Value, sort: IVL.Sort): IVL.Term =>
		match(NF.unwrapNeutral(val))
			.with(NF.Patterns.Rigid, ({ variable }) => Build.var_(nameAt(bound, variable.lvl), sort))
			.with(NF.Patterns.Free, NF.Patterns.Foreign, ({ variable }) => Build.const_(variable.name, sort))
			.with(NF.Patterns.External, e => Build.const_(e.name, sort))
			.with(NF.Patterns.App, a => head(a.func, sort))
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

	const sort = yield* mkSort(getType(value));

	const collectFnSorts = (s: IVL.Sort): { args: IVL.Sort[]; ret: IVL.Sort } =>
		match(s)
			.with({ tag: "Fn" }, ({ args, ret }) => ({ args, ret }))
			.otherwise(s => ({ args: [], ret: s }));

	const { ret } = collectFnSorts(sort);
	return { head: head(value, sort), ret };
};

const collectArgs = function* (value: NF.Value): Verification<IVL.Term[]> {
	return yield* match(value)
		.with(NF.Patterns.App, function* ({ func, arg }) {
			const head = yield* collectArgs(func);
			const translated = yield* term(arg);
			return [...head, translated];
		})
		.otherwise(function* (): Verification<IVL.Term[]> {
			return [];
		});
};

export const term = function* (nf: NF.Value): Verification<IVL.Term> {
	const ctx = yield* reader.ask();
	/* The kind is set aside on purpose: it says why a value is stuck, and a term encodes only its structure. */
	const { value: structure } = yield* NF.view(nf);
	return yield* match(structure)
		.with({ type: "Neutral" }, function* ({ value }) {
			return yield* term(value);
		})
		.with({ type: "Modal" }, function* ({ value }) {
			return yield* term(value);
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
			const { head, ret } = yield* getFnSorts(fn);
			const args = yield* collectArgs(fn);

			if (args.length === 0) {
				return head;
			}
			return Build.select(head, args[0], ret);
		})
		.with(NF.Patterns.DepLabel, function* ({ variable }) {
			return Build.const_(`&${variable.lvl}.${variable.name}`, yield* mkSort(variable.annotation));
		})
		.with(NF.Patterns.NuLabel, function* ({ variable }) {
			return Build.const_(`$${variable.lvl}.${variable.name}`, yield* mkSort(variable.annotation));
		})
		.with(NF.Patterns.Var, function* (v) {
			if (v.variable.type === "Bound") {
				const entry = ctx.env[EB.lvl2idx(ctx, v.variable.lvl)];
				const sort = yield* mkSort(entry.type[2]);
				return Build.var_(nameAt(yield* names.ask(), v.variable.lvl), sort);
			}
			if (v.variable.type === "Free") {
				const [t] = ctx.imports[v.variable.name];
				const evaluated = yield* NF.evaluate(t);
				return yield* term(evaluated);
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
						return yield* term(sig.value);
					}
				}
				const ty = ctx.labels[name];
				const sort = ty ? yield* mkSort(ty) : Build.uninterpreted("Label");
				return Build.const_(name, sort);
			}
			throw new Error(`Unsupported variable in formula translation: ${v.variable.type} (${JSON.stringify(v.variable)})`);
		})
		.with(
			BooleanExternal,
			e => e.args.length === e.arity,
			function* () {
				return Build.prop(yield* formula(nf));
			},
		)
		.with({ type: "External" }, function* (e) {
			if (e.args.length !== e.arity) {
				throw new Error("External with wrong arity in logical formulas");
			}
			const args = yield* Eff.traverse(e.args, term);
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

export const formula = function* (nf: NF.Value): Verification<IVL.Formula> {
	/* As in `term`, the kind is set aside: a formula encodes only the structure. */
	const { value: structure } = yield* NF.view(nf);
	return yield* match(structure)
		.with({ type: "Neutral" }, function* ({ value }) {
			return yield* formula(value);
		})
		.with({ type: "Modal" }, function* ({ value }) {
			return yield* formula(value);
		})
		.with(NF.Patterns.Lit, function* ({ value }) {
			if (value.type === "Bool") {
				return value.value ? Build.true_() : Build.false_();
			}
			return Build.atom("=", yield* term(nf), Build.bool(true));
		})
		.with({ type: "External" }, function* ({ name, args }) {
			return yield* match(name)
				.with(OP_AND, function* () {
					return Build.and(yield* formula(args[0]), yield* formula(args[1]));
				})
				.with(OP_OR, function* () {
					return Build.or(yield* formula(args[0]), yield* formula(args[1]));
				})
				.with(OP_NOT, function* () {
					return Build.not(yield* formula(args[0]));
				})
				.with(OP_EQ, function* () {
					return Build.atom("=", yield* term(args[0]), yield* term(args[1]));
				})
				.with(OP_NEQ, function* () {
					return Build.atom("!=", yield* term(args[0]), yield* term(args[1]));
				})
				.with(OP_GT, function* () {
					return Build.atom(">", yield* term(args[0]), yield* term(args[1]));
				})
				.with(OP_GTE, function* () {
					return Build.atom(">=", yield* term(args[0]), yield* term(args[1]));
				})
				.with(OP_LT, function* () {
					return Build.atom("<", yield* term(args[0]), yield* term(args[1]));
				})
				.with(OP_LTE, function* () {
					return Build.atom("<=", yield* term(args[0]), yield* term(args[1]));
				})
				.otherwise(function* () {
					return Build.atom("=", yield* term(nf), Build.bool(true));
				});
		})
		.otherwise(function* () {
			return Build.atom("=", yield* term(nf), Build.bool(true));
		});
};

const nameAt = (bound: ReadonlyMap<number, string>, lvl: number): string =>
	match(bound.get(lvl))
		.with(undefined, () => {
			throw new Error(`No IVL name for the variable at level ${lvl}`);
		})
		.otherwise(name => name);

export const scope = function* <A>(name: string, binder: EB.Binder, annotation: NF.Value, program: Verification<A>): Verification<A> {
	const lvl = (yield* reader.ask()).env.length;
	return yield* reader.local(
		c => EB.bind(c, binder, annotation),
		names.local(bound => new Map([...bound, [lvl, name]]), program),
	);
};

/* The annotation is read in the binder's outer scope; its refinement is translated inside that binder. */
export const quantify = function* (name: string, annotation: NF.Value, vc: IVL.Formula): Verification<IVL.Formula> {
	const ctx = yield* reader.ask();
	return yield* match(yield* NF.view(annotation))
		.with(NF.View.Sealed({ type: "Existential" }), function* ({ value: ex }) {
			const existential = yield* supply.freshFrom(ex.variable);
			const inner = yield* reader.local(
				() => ex.body.ctx,
				scope(existential, { type: "Pi", variable: ex.variable }, ex.annotation, quantify(name, ex.body.value, vc)),
			);
			return yield* reader.local(() => ex.body.ctx, quantify(existential, ex.annotation, inner));
		})
		.with(NF.View.Sealed(NF.Patterns.Pi), function* () {
			return vc;
		})
		.with(NF.View.Sealed(NF.Patterns.Modal), function* ({ value: { modalities } }) {
			const sort = yield* mkSort(annotation);
			assert(modalities.liquid.type === "Abs", "Liquid refinements must be unary functions");
			const applied = yield* NF.apply(modalities.liquid.binder, modalities.liquid.closure, NF.Constructors.Rigid(ctx.env.length));
			const phi = yield* scope(name, { type: "Pi", variable: name }, annotation, formula(applied));
			return yield* obligations.record(`quantify:${name}`, Build.forall([{ name, sort }], Build.implies(phi, vc)), {
				description: `Quantifying refined ${name}`,
			});
		})
		.otherwise(function* () {
			const sort = yield* mkSort(annotation);
			return yield* obligations.record(`quantify:${name}`, Build.forall([{ name, sort }], vc), {
				description: `Quantifying over ${name}`,
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
