import { isMatching, match, P } from "ts-pattern";

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
	OP_LIVE,
	OP_MUL,
	OP_NEQ,
	OP_NOT,
	OP_OR,
	OP_SUB,
	primopMapping,
	PrimOps,
} from "@yap/shared/lib/primitives";

import type { Predicate } from "../../horn";
import { Patterns } from "../../solver/ivl/patterns";
import type { IVL } from "../../solver/ivl/types";
import { Build } from "../../solver/ivl/build";
import { reader, obligations, names, state, State, definitions, supply, type Verification, type Hypothesis } from "../effects";

const BooleanExternal = { ...NF.Patterns.External, name: P.union(OP_EQ, OP_NEQ, OP_LT, OP_GT, OP_LTE, OP_GTE, OP_AND, OP_OR, OP_NOT, OP_LIVE) } as const;
const ForeignConstant = { ...NF.Patterns.External, arity: 0, args: [] } as const;

export const live = function* (current: NF.Value, identity: NF.Value): Verification<IVL.Formula> {
	const { value } = yield* NF.view(current);
	const ambient = function* () {
		const available = yield* term(current);
		const requested = yield* term(identity);
		return Build.atom("=", Build.app("$state.live", [available, requested], Build.Bool), Build.bool(true));
	};
	return yield* match(value)
		.with(
			NF.Patterns.Existential,
			ex => ex.assumptions.size > 0,
			function* ({ assumptions, body }) {
				return yield* definitions.local(
					outer => new Map([...outer, ...[...assumptions].map(([variable, value]) => [variable.lvl, value] as const)]),
					live(body.value, identity),
				);
			},
		)
		.with(NF.Patterns.Rigid, function* ({ variable }) {
			const env = yield* definitions.ask();
			const definition = env.get(variable.lvl);
			if (!definition) {
				return yield* ambient();
			}
			return yield* live(definition, identity);
		})
		.with(State.Patterns.empty, function* () {
			return Build.false_();
		})
		.with(State.Patterns.insert, function* ({ args: [, previous, added] }) {
			const installed = yield* term(added);
			const requested = yield* term(identity);
			/* Installing an identity preserves every handler available in the previous state.
			 * Membership holds when the requested identity matches this installation or was available before it. */
			const availableBeforeInsertion = yield* live(previous, identity);
			return Build.or(Build.atom("=", installed, requested), availableBeforeInsertion);
		})
		.otherwise(ambient);
};

/** The validity checker instantiates residual IVL holes in the VC emitted before inference. */
export function* predicate(value: NF.Value): Verification<Predicate> {
	const head = yield* NF.view(value);
	if (isMatching(NF.View.Sealed(NF.Patterns.Lambda), head)) {
		const { binder, closure } = head.value;
		const outer = yield* reader.ask();
		const name = yield* supply.freshFrom(binder.variable);
		const sort = yield* mkSort(binder.annotation);
		const nested = yield* scope(
			name,
			binder,
			binder.annotation,
			(function* () {
				const applied = yield* NF.apply(binder, closure, NF.Constructors.Rigid(outer.env.length));
				return yield* predicate(applied);
			})(),
		);
		return { params: [{ name, sort }, ...nested.params], body: nested.body };
	}
	return { params: [], body: yield* formula(value) };
}

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

const application = function* (nf: NF.Value): Verification<IVL.Term> {
	const { value } = yield* NF.view(nf);
	return yield* match(value)
		.with(
			NF.Patterns.Existential,
			ex => ex.assumptions.size > 0,
			function* ({ assumptions, body }) {
				return yield* definitions.local(
					outer => new Map([...outer, ...[...assumptions].map(([variable, value]) => [variable.lvl, value] as const)]),
					application(body.value),
				);
			},
		)
		.with(NF.Patterns.App, function* ({ func, arg }) {
			const fn = yield* application(func);
			const input = yield* term(arg);
			return match(fn)
				.with(Patterns.Term.Hole, ({ kappa, spine }) => Build.hole(kappa, [...spine, input]))
				.with({ sort: Patterns.Sort.Fn }, ({ sort }) => Build.select(fn, input, sort.ret))
				.with({ sort: P.select() }, sort => Build.select(fn, input, sort))
				.otherwise(() => {
					throw new Error("Expected a logical function");
				});
		})
		.with(NF.Patterns.Rigid, function* ({ variable }) {
			const definition = (yield* definitions.ask()).get(variable.lvl);
			return yield* definition ? application(definition) : term(nf);
		})
		.with(NF.Patterns.Free, NF.Patterns.Foreign, function* ({ variable }) {
			const symbol = match(variable)
				.with({ type: "Free" }, ({ name }) => name)
				.with({ type: "Foreign" }, ({ name }) => {
					if (!(name in PrimOps)) {
						throw new Error(`Foreign function "${name}" is unsupported in logical formulas`);
					}
					return primopMapping[name];
				})
				.exhaustive();
			const ctx = yield* reader.ask();
			return Build.const_(variable.name, yield* mkSort(ctx.imports[symbol][1]));
		})
		.with(NF.Patterns.Flex, function* ({ variable }) {
			const head = yield* term(nf);
			if (head.tag === "Hole") {
				return head;
			}
			const entry = Metas.lookup(yield* Metas.registry.get(), variable.val);
			throw new Error(`Expected a predicate in function position, found ${entry?.kind ?? "unregistered"} meta ?${variable.val}`);
		})
		.with(NF.Patterns.External, function* ({ name }) {
			throw new Error(`External "${name}" requires external translation before its use as a logical function head`);
		})
		.with(NF.Patterns.Label, NF.Patterns.DepLabel, NF.Patterns.NuLabel, function* ({ variable }) {
			throw new Error(`Unsupported ${variable.type} variable "${variable.name}" in logical function position`);
		})
		.otherwise(function* (value) {
			throw new Error(`Expected a logical function, found ${value.type}`);
		});
};

export const term = function* (nf: NF.Value): Verification<IVL.Term> {
	const ctx = yield* reader.ask();
	/* The kind is set aside on purpose: it says why a value is stuck, and a term encodes only its structure. */
	const { value: structure } = yield* NF.view(nf);
	return yield* match(structure)
		.with(
			NF.Patterns.Existential,
			ex => ex.assumptions.size > 0,
			function* ({ assumptions, body }) {
				return yield* definitions.local(
					outer => new Map([...outer, ...[...assumptions].map(([variable, value]) => [variable.lvl, value] as const)]),
					term(body.value),
				);
			},
		)
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
		.with(State.Patterns.insert, function* ({ args: [, previous, installed] }) {
			const current = yield* term(previous);
			const identity = yield* term(installed);
			const sort = yield* mkSort(NF.State);
			return Build.app(State.heads.insert, [current, identity], sort);
		})
		.with(NF.Patterns.App, () => application(nf))
		.with(NF.Patterns.DepLabel, function* ({ variable }) {
			return Build.const_(`&${variable.lvl}.${variable.name}`, yield* mkSort(variable.annotation));
		})
		.with(NF.Patterns.NuLabel, function* ({ variable }) {
			return Build.const_(`$${variable.lvl}.${variable.name}`, yield* mkSort(variable.annotation));
		})
		.with(NF.Patterns.Foreign, function* ({ variable }) {
			const [, annotation] = ctx.imports[variable.name];
			const sort = yield* mkSort(annotation);
			return Build.const_(variable.name, sort);
		})
		.with(NF.Patterns.Rigid, function* ({ variable }) {
			const env = yield* definitions.ask();
			const definition = env.get(variable.lvl);
			if (!definition) {
				const entry = ctx.env[EB.lvl2idx(ctx, variable.lvl)];
				const sort = yield* mkSort(entry.type[2]);
				return Build.var_(nameAt(yield* names.ask(), variable.lvl), sort);
			}
			return yield* term(definition);
		})
		.with(NF.Patterns.Var, function* (v) {
			if (v.variable.type === "Free") {
				const [t] = ctx.imports[v.variable.name];
				const evaluated = yield* NF.evaluate(t);
				return yield* term(evaluated);
			}
			if (v.variable.type === "Meta") {
				const entry = Metas.lookup(yield* Metas.registry.get(), v.variable.val);
				if (entry?.kind === "Predicate") {
					return Build.hole(entry.meta.val);
				}
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
		.with(ForeignConstant, function* ({ name }) {
			// TODO: Revisit this translation when atom introduction gains another form alongside foreign declarations.
			const [, annotation] = ctx.imports[name];
			const sort = yield* mkSort(annotation);
			return Build.const_(name, sort);
		})
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
		.with(
			NF.Patterns.Existential,
			ex => ex.assumptions.size > 0,
			function* ({ assumptions, body }) {
				return yield* definitions.local(
					outer => new Map([...outer, ...[...assumptions].map(([variable, value]) => [variable.lvl, value] as const)]),
					formula(body.value),
				);
			},
		)
		.with(NF.Patterns.Rigid, function* ({ variable }) {
			const env = yield* definitions.ask();
			const definition = env.get(variable.lvl);
			if (!definition) {
				return Build.atom("=", yield* term(nf), Build.bool(true));
			}
			return yield* formula(definition);
		})
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
				.with(OP_LIVE, function* () {
					const [current, , , identity] = args;
					return yield* live(current, identity);
				})
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
		names.local(
			bound => new Map([...bound, [lvl, name]]),
			match(binder)
				.with({ type: "Psi" }, () => state.local(() => NF.Constructors.Rigid(lvl), program))
				.otherwise(() => program),
		),
	);
};

/* The annotation is read in the binder's outer scope; its refinement is translated inside that binder. */
export const bindings = function* (name: string, annotation: NF.Value): Verification<Hypothesis[]> {
	const ctx = yield* reader.ask();
	return yield* match(yield* NF.view(annotation))
		.with(NF.View.Sealed({ type: "Existential" }), function* ({ value: ex }): Verification<Hypothesis[]> {
			const existential = yield* supply.freshFrom(ex.variable);
			const inner = yield* reader.local(
				() => ex.body.ctx,
				scope(existential, { type: "Pi", variable: ex.variable }, ex.annotation, bindings(name, ex.body.value)),
			);
			const outer = yield* reader.local(() => ex.body.ctx, bindings(existential, ex.annotation));
			return [...outer, ...inner];
		})
		.with(NF.View.Sealed(NF.Patterns.Pi), NF.View.Sealed(NF.Patterns.Psi), () => Eff.of<Hypothesis[]>([]))
		.with(NF.View.Sealed(NF.Patterns.Modal), function* ({ value: { modalities } }) {
			const sort = yield* mkSort(annotation);
			const value = NF.Constructors.Rigid(ctx.env.length);
			return yield* scope(
				name,
				{ type: "Pi", variable: name },
				annotation,
				(function* () {
					const predicate = yield* NF.reduce(modalities.liquid, value, "Explicit");
					return [{ binder: { name, sort }, level: ctx.env.length, premise: predicate, formula: yield* formula(predicate) }];
				})(),
			);
		})
		.otherwise(function* () {
			const sort = yield* mkSort(annotation);
			return [{ binder: { name, sort }, level: ctx.env.length }];
		});
};

export const quantify = function* ([entry, ...rest]: Hypothesis[], goal: IVL.Formula): Verification<IVL.Formula> {
	if (!entry) {
		return goal;
	}
	const { binder, formula: premise } = entry;
	const body = yield* quantify(rest, goal);
	return yield* obligations.record(`quantify:${binder.name}`, Build.forall([binder], premise ? Build.implies(premise, body) : body), {
		description: `Quantifying ${premise ? "refined" : "over"} ${binder.name}`,
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
