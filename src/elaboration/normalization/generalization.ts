import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as R from "@yap/shared/rows";

import * as Eff from "@yap/utils/effects";

import fp from "lodash/fp";
import * as A from "fp-ts/Array";
import { update } from "@yap/utils";
import * as Sub from "../unification/substitution";
import * as Computation from "./computation-traversal";

type Meta = Extract<NF.Variable, { type: "Meta" }>;

/** Generalization touches the scope, the metacontext, and the supply (placeholder minting for the rewiring). */
export type Generalization<A> = Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Actions<typeof Metas.registry> | Eff.Actions<typeof M.supply>, A>;

/** Abstraction (binder wrapping) shares generalization's concerns. */
export type Abstraction<A> = Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Actions<typeof Metas.registry> | Eff.Actions<typeof M.supply>, A>;

const charCodes = {
	any: "A".charCodeAt(0),
	type: "a".charCodeAt(0),
	typeCtor: "F".charCodeAt(0),
	row: "r".charCodeAt(0),
	num: "n".charCodeAt(0),
	fun: "f".charCodeAt(0),
};

const mkCounters = () => ({
	any: 0,
	type: 0,
	typeCtor: 0,
	row: 0,
	num: 0,
	fun: 0,
});
const nextCode = (counters: ReturnType<typeof mkCounters>) => (category: keyof typeof counters) => {
	const index = counters[category];
	counters[category] += 1;
	return String.fromCharCode(charCodes[category] + index);
};

const getNameFactory = (counters: ReturnType<typeof mkCounters>) => {
	const inc = nextCode(counters);

	return function* (ann: NF.Value): Generalization<string> {
		const { value } = yield* NF.view(ann);

		return match(value)
			.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => inc("type"))
			.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => inc("row"))
			.with({ type: "Lit", value: { type: "Num" } }, () => inc("num"))
			.with(NF.Patterns.Pi, () => inc("typeCtor"))
			.with(NF.Patterns.Lambda, () => inc("fun"))
			.otherwise(() => inc("any"));
	};
};
/**
 * Generalizes a value by replacing meta variables with bound variables, which are introduced by wrapping the value in a Pi type for each meta variable.
 * Only generalizes metas created at a deeper level than the current context (i.e., local to this let-binding).
 * Metas from outer scopes (with lvl < ctx.env.length) are NOT generalized, implementing proper let-polymorphism scoping.
 *
 * Generalization requires collecting the metas in both the type and the term, since the term may contain implicit arguments that introduce additional metas.
 * Eg:
 * ```
 * fmap: (f: Type -> Type, functor: Functor f, a: Type, b: Type) => (a -> b) -> f a -> f b
 * stringify: (a: Type) => a -> String
 *
 * fmap stringify
 * ```
 * Here, generalizing the type of `fmap stringify` alone would miss the meta for `functor`, as its never used in the type.
 */
export const generalize = function* (ty: NF.Value, tm: EB.Term, resolutions: EB.Resolutions): Generalization<[NF.Value, boolean]> {
	const ctx = yield* M.reader.ask();
	const registry = yield* Metas.registry.get();

	const { nf, eb } = yield* Metas.collectors();
	const seed = fp.uniqBy((m: Meta) => m.val, [...nf(ty), ...eb(tm)]);

	const allMetas = (yield* Metas.Annotations.closeOver(seed)).filter(m => !resolutions[m.val]);
	const getName = getNameFactory(mkCounters());

	// Filter out metas from outer scopes - only generalize metas created in the current scope
	// A meta's lvl indicates the context depth when it was created
	const ms = allMetas.filter(m => m.lvl >= ctx.env.length);

	if (ms.length === 0) {
		return [ty, false];
	}

	const names = yield* Eff.traverse(ms, m => getName(Metas.entry(registry, m.val).annotation));

	// Build a single closure context that has all generalized metas mapped to the corresponding bound variables.
	// We also pre-extend names/types/env so quoting inside closures sees the right level indices.
	const { ctx: extendedCtx, subst } = ms.reduce(
		(acc, m, i) => {
			const boundLvl = i + ctx.env.length; // outermost binder is the first one after the existing env
			const { annotation } = Metas.entry(registry, m.val);

			const withBinder = EB.bind(acc.ctx, { type: "Pi", variable: names[i] }, annotation, "inserted");
			const next = { ...acc.subst, [m.val]: NF.Constructors.Var({ type: "Bound", lvl: boundLvl }) };
			return { ctx: withBinder, subst: next };
		},
		{ ctx, subst: Sub.empty },
	);
	// Wrap from inner to outer. Each Pi body is quoted with lvl equal to the number of binders in scope.
	const wrap = function* (body: NF.Value, rest: readonly Meta[], i: number): Generalization<NF.Value> {
		if (rest.length === 0) {
			return body;
		}
		const [m, ...tail] = rest;
		const variable = extendedCtx.env[i].name.variable;
		const trimmed = update(extendedCtx, "env", e => e.slice(i)); // trim the already introduced binders from the env for quoting
		// Quote with all binders in scope: lvl = ms.length - i
		const term = yield* M.reader.local(_ => trimmed, NF.quote(ctx.env.length + ms.length - i, body));
		const { annotation } = Metas.entry(registry, m.val);
		const closureCtx = update(trimmed, "env", e => e.slice(1)); // drop the binder we are introducing now so it doesn't get captured in the closure
		return yield* wrap(NF.Constructors.Pi(variable, "Implicit", annotation, NF.Constructors.Closure(closureCtx, term)), tail, i + 1);
	};
	const generalized = yield* wrap(ty, A.reverse(ms), 0);

	/*
	 * Rewiring (first-order partial renaming, degenerated to its stable form): an
	 * outer solved meta whose solution mentions the generalized metas holds a
	 * pre-telescope snapshot. Its truth after this commit is the generalized type:
	 * the snapshot moves to a placeholder meta rooted under the telescope, and the
	 * container re-solves to the telescope wrapper around the placeholder — every
	 * dereference chain then routes through closures that carry the telescope slots.
	 */
	const generalizedIds = new Set(ms.map(m => m.val));
	const containers = Object.values(registry).filter(
		entry => entry.solution && entry.meta.lvl < ctx.env.length && nf(entry.solution).some(m => generalizedIds.has(m.val)),
	);
	yield* Eff.traverse(containers, function* (container): Generalization<void> {
		const snapshot = container.solution;
		if (!snapshot) {
			return;
		}
		const placeholder = yield* Metas.fresh(ctx.env.length + ms.length, container.annotation);
		const wrapper = yield* wrap(NF.Constructors.Var({ type: "Meta", val: placeholder.val, lvl: placeholder.lvl }), A.reverse(ms), 0);
		yield* Metas.registry.modify(current => Metas.solve(Metas.solve(current, placeholder.val, snapshot), container.meta.val, wrapper));
	});

	/*
	 * Recorded after the wrap, never before: the binders these metas map to only exist
	 * in the telescope, so the mapping must not be readable while the body is being
	 * quoted. Quoting descends into each closure's own spine, where that level denotes
	 * a different binder — v2 got this from the zonker riding the ctx that quote swapped.
	 * The metas stay symbolic in the generalized syntax and resolve at use, once the
	 * telescope binder is actually in scope.
	 */
	yield* Metas.registry.modify(current => Metas.withSolutions(current, subst));

	return [generalized, true];
};

type Abstracted = {
	term: EB.Term;
	type: NF.Value;
};

/**
 * Generalize a semantic return value at its lexical boundary.
 *
 * The value is evaluated before abstraction, so its free variables are stable
 * levels. Quoting under the inserted binders then reconstructs their indices
 * without syntactically capturing block-local bindings.
 */
export const abstract = function* (ty: NF.Value, value: NF.Value, resolutions: EB.Resolutions): Abstraction<Abstracted> {
	const ctx = yield* M.reader.ask();
	const registry = yield* Metas.registry.get();

	const { nf } = yield* Metas.collectors();
	const seed = fp.uniqBy((m: Meta) => m.val, [...nf(ty), ...nf(value)]);
	const allMetas = (yield* Metas.Annotations.closeOver(seed)).filter(m => !resolutions[m.val]);
	const ms = allMetas.filter(m => m.lvl >= ctx.env.length);

	if (ms.length === 0) {
		return { term: yield* NF.quote(ctx.env.length, value), type: ty };
	}

	const getName = getNameFactory(mkCounters());

	type Entry = { binding: EB.Binding; meta: Meta; val: NF.Value };
	type Extended = { ctx: EB.Context; entries: Entry[] };
	const extend = function* (acc: Extended, rest: readonly Meta[], i: number): Abstraction<Extended> {
		if (rest.length === 0) {
			return acc;
		}
		const [m, ...tail] = rest;
		const { annotation } = Metas.entry(registry, m.val);
		const variable = yield* getName(annotation);
		const binding: EB.Binding = {
			type: "Lambda",
			variable,
			icit: "Implicit",
			annotation: yield* M.reader.local(_ => acc.ctx, NF.quote(acc.ctx.env.length, annotation)),
		};
		const pi: EB.Binding = { ...binding, type: "Pi" };
		const boundLvl = i + ctx.env.length;
		return yield* extend(
			{
				ctx: EB.bind(acc.ctx, pi, annotation, "inserted"),
				entries: [...acc.entries, { binding, meta: m, val: NF.Constructors.Var({ type: "Bound", lvl: boundLvl }) }],
			},
			tail,
			i + 1,
		);
	};
	const { entries, ctx: xtended } = yield* extend({ ctx, entries: [] }, ms, 0);

	const subst = entries.reduce((sub, { meta, val }) => ({ ...sub, [meta.val]: val }), Sub.empty);

	const wrap = function* (body: NF.Value, rest: readonly Entry[], i: number): Abstraction<NF.Value> {
		if (rest.length === 0) {
			return body;
		}
		const [{ meta }, ...tail] = rest;
		const variable = xtended.env[i].name.variable;
		const trimmed = update(xtended, "env", env => env.slice(i));
		const term = yield* M.reader.local(_ => trimmed, NF.quote(ctx.env.length + ms.length - i, body));
		const { annotation } = Metas.entry(registry, meta.val);
		const closureCtx = update(trimmed, "env", env => env.slice(1));
		return yield* wrap(NF.Constructors.Pi(variable, "Implicit", annotation, NF.Constructors.Closure(closureCtx, term)), tail, i + 1);
	};
	const type = yield* wrap(ty, A.reverse(entries), 0);

	/* Rewiring: same first-order move as generalize — see the comment there. */
	const generalizedIds = new Set(ms.map(m => m.val));
	const containers = Object.values(registry).filter(
		entry => entry.solution && entry.meta.lvl < ctx.env.length && nf(entry.solution).some(m => generalizedIds.has(m.val)),
	);
	yield* Eff.traverse(containers, function* (container): Abstraction<void> {
		const snapshot = container.solution;
		if (!snapshot) {
			return;
		}
		const placeholder = yield* Metas.fresh(ctx.env.length + ms.length, container.annotation);
		const wrapper = yield* wrap(NF.Constructors.Var({ type: "Meta", val: placeholder.val, lvl: placeholder.lvl }), A.reverse(entries), 0);
		yield* Metas.registry.modify(current => Metas.solve(Metas.solve(current, placeholder.val, snapshot), container.meta.val, wrapper));
	});

	/*
	 * The body must see the mapping so quoting resolves the metas to their introduced
	 * binder variables. The type wrap above intentionally leaves them symbolic — those
	 * metas resolve at each use site when the telescope binder is actually in scope.
	 */
	yield* Metas.registry.modify(current => Metas.withSolutions(current, subst));

	const body = yield* M.reader.local(_ => xtended, NF.quote(xtended.env.length, value));
	const term = A.reverse(entries).reduce((body, { binding }) => EB.Constructors.Abs(binding, body), body);

	return { term, type };
};

/**
 * Instantiates unconstrained meta variables in a Normal Form (NF) to default values based on their annotations.
 * Constrained metas (those with a registry solution) are left alone.
 * Metas from outer scopes (lvl < ctx.env.length) are also left alone - they will be solved at their original scope.
 */
export const instantiate = function* (nf: NF.Value): EB.Icit.Zonking<NF.Value> {
	const ctx = yield* M.reader.ask();
	const registry = yield* Metas.registry.get();
	const defaulted = (meta: Meta, lvl: number): NF.Value | undefined => {
		if (meta.lvl < lvl || Metas.solution(registry, meta.val)) {
			return undefined;
		}
		return match(Metas.entry(registry, meta.val).annotation)
			.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => NF.Constructors.Row(R.Constructors.Empty()))
			.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => NF.Any)
			.otherwise(() => undefined);
	};
	const term = (term: EB.Term, lvl: number): EB.Term =>
		EB.traverse(term, (term, depth) =>
			match(term)
				.with(EB.CtorPatterns.Vars.Meta, ({ variable }) =>
					match(defaulted(variable, lvl + depth))
						.with(NF.Patterns.Row, () => EB.Constructors.Row(R.Constructors.Empty()))
						.with(NF.Patterns.Lit, ({ value }) => EB.Constructors.Lit(value))
						.otherwise(() => term),
				)
				.otherwise(() => term),
		);
	const source = (saved: NF.Source, seen: ReadonlySet<NF.Value>, depth = 0): NF.Source =>
		Computation.mapSourceValues(
			saved,
			(value, ctx) => visit(value, ctx.env.length, seen),
			(value, ctx, depth) => term(value, ctx.env.length + depth),
			depth,
		);
	const visit = (value: NF.Value, lvl: number, seen: ReadonlySet<NF.Value>): NF.Value => {
		if (seen.has(value)) {
			return value;
		}
		const within = new Set([...seen, value]);
		const recur = (value: NF.Value) => visit(value, lvl, within);
		const saved = (value: NF.Source, depth = 0) => source(value, within, depth);
		return match(value)
			.with(NF.Patterns.Flex, value => defaulted(value.variable, lvl) ?? value)
			.with(NF.Patterns.Var, NF.Patterns.Lit, value => value)
			.with(NF.Patterns.Nu, value => {
				const { binder, closure } = value;
				const body = saved({ ctx: closure.ctx, term: EB.Constructors.Nu({ ...binder, annotation: binder.source?.annotation ?? EB.Type }, closure.term) });
				return match(body.term)
					.with(EB.CtorPatterns.Nu, ({ binding, body: term }) =>
						NF.Constructors.Nu(
							{ ...binder, annotation: recur(binder.annotation), scoped: binding.scoped, source: binder.source ? binding : undefined },
							{ ...closure, ctx: body.ctx, term },
						),
					)
					.otherwise(() => {
						throw new Error("A saved field scope retains its binder");
					});
			})
			.with({ type: "Abs" }, value => {
				const closure = saved(value.closure, value.binder.type === "Sigma" ? 0 : 1);
				return {
					...value,
					binder: { ...value.binder, annotation: recur(value.binder.annotation) },
					closure: { ...value.closure, ctx: closure.ctx, term: closure.term },
				};
			})
			.with(NF.Patterns.App, value => NF.Constructors.App(recur(value.func), recur(value.arg), value.icit))
			.with(NF.Patterns.Proj, value => NF.Constructors.Proj(recur(value.base), value.label))
			.with(NF.Patterns.Match, value => {
				const closure = saved(value.closure);
				return NF.Constructors.Match({ ...value.closure, ctx: closure.ctx, term: closure.term }, recur(value.scrutinee));
			})
			.with(NF.Patterns.Inj, value => NF.Constructors.Inj(recur(value.base), value.label, recur(value.injected)))
			.with(NF.Patterns.Row, value => NF.Constructors.Row(R.traverse(value.row, recur, variable => R.Constructors.Variable(variable))))
			.with(NF.Patterns.Neutral, value => NF.Constructors.Neutral(value.kind, recur(value.value)))
			.with(NF.Patterns.Glued, value => NF.Constructors.Glued(recur(value.folded), recur(value.unfolded)))
			.with(NF.Patterns.Modal, value => NF.Constructors.Modal(recur(value.value), { ...value.modalities, liquid: recur(value.modalities.liquid) }))
			.with(NF.Patterns.External, value => NF.Constructors.External(value.name, value.arity, value.compute, value.args.map(recur)))
			.with(NF.Patterns.Suspend, value =>
				NF.Constructors.Suspend(recur(value.identity), recur(value.payload), recur(value.annotation), value.signature ? recur(value.signature) : undefined),
			)
			.with(NF.Patterns.Deferred, value => NF.Constructors.Deferred(saved(value.source)))
			.with(NF.Patterns.Computation, value =>
				NF.Constructors.Computation(
					visit(value.request, value.ctx.env.length, within),
					value.contexts.map(context => Computation.mapContext(context, (value, ctx) => visit(value, ctx.env.length, within), saved)),
					value.ctx,
				),
			)
			.with({ type: "Existential" }, value => ({
				...value,
				annotation: recur(value.annotation),
				body: { ...value.body, value: visit(value.body.value, value.body.ctx.env.length, within) },
			}))
			.exhaustive();
	};
	return visit(nf, ctx.env.length, new Set());
};

/**
 * Trims the first entry from the env of all closures in a value.
 * This is used when moving top-level recursive letdecs from env to imports.
 *
 * For top-level letdecs, we add the variable to env at level 0 to allow recursion during elaboration.
 * Any closures created during elaboration capture this env.
 * After elaboration, we move the variable to imports, so we need to trim it from the captured envs
 * to avoid env length mismatches. Lookups will then correctly fall through to imports.
 */
export const trimClosureEnvs = (nf: NF.Value, seen: ReadonlySet<NF.Value> = new Set()): NF.Value => {
	if (seen.has(nf)) {
		return nf;
	}
	const within = new Set([...seen, nf]);
	const recur = (value: NF.Value) => trimClosureEnvs(value, within);
	const source = (saved: NF.Source): NF.Source => {
		const mapped = Computation.mapSourceValues(saved, recur, term => term);
		return { ctx: { ...mapped.ctx, env: mapped.ctx.env.slice(0, -1) }, term: mapped.term };
	};
	return match(nf)
		.with({ type: "Var" }, v => v)
		.with({ type: "Lit" }, lit => lit)
		.with({ type: "Abs" }, abs => {
			const ann = recur(abs.binder.annotation);
			const trimmedClosure = {
				...abs.closure,
				ctx: {
					...abs.closure.ctx,
					env: abs.closure.ctx.env.slice(0, abs.closure.ctx.env.length - 1), // Remove first entry (the recursive variable at level 0)
				},
			};
			return { ...abs, binder: { ...abs.binder, annotation: ann }, closure: trimmedClosure };
		})

		.with({ type: "App" }, ({ icit, func, arg }) => NF.Constructors.App(recur(func), recur(arg), icit))
		.with(NF.Patterns.Proj, ({ base, label }) => NF.Constructors.Proj(recur(base), label))
		.with(NF.Patterns.Match, ({ closure, scrutinee }) => NF.Constructors.Match(closure, recur(scrutinee)))
		.with(NF.Patterns.Inj, ({ base, label, injected }) => NF.Constructors.Inj(recur(base), label, recur(injected)))
		.with({ type: "Row" }, ({ row }) =>
			NF.Constructors.Row(
				R.traverse(
					row,
					v => recur(v),
					v => R.Constructors.Variable(v),
				),
			),
		)
		.with({ type: "Neutral" }, ({ kind, value }) => NF.Constructors.Neutral(kind, recur(value)))
		.with(NF.Patterns.Glued, ({ folded, unfolded }) => NF.Constructors.Glued(recur(folded), recur(unfolded)))
		.with(NF.Patterns.Modal, ({ value, modalities }) =>
			NF.Constructors.Modal(recur(value), {
				quantity: modalities.quantity,
				liquid: recur(modalities.liquid),
			}),
		)
		.with(NF.Patterns.Suspend, value =>
			NF.Constructors.Suspend(recur(value.identity), recur(value.payload), recur(value.annotation), value.signature ? recur(value.signature) : undefined),
		)
		.with(NF.Patterns.Deferred, value => NF.Constructors.Deferred(source(value.source)))
		.with(NF.Patterns.Computation, value =>
			NF.Constructors.Computation(
				recur(value.request),
				value.contexts.map(context => ({ ...Computation.mapContext(context, recur, source), ctx: { ...context.ctx, env: context.ctx.env.slice(0, -1) } })),
				{ ...value.ctx, env: value.ctx.env.slice(0, -1) },
			),
		)
		.with(NF.Patterns.External, value => NF.Constructors.External(value.name, value.arity, value.compute, value.args.map(recur)))
		.otherwise(() => {
			throw new Error("trimClosureEnvs: Not implemented yet");
		});
};
