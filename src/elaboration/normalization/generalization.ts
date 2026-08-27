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

type Meta = Extract<NF.Variable, { type: "Meta" }>;

/** Generalization touches the scope and the metacontext, nothing else. */
export type Generalization<A> = Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Actions<typeof Metas.registry>, A>;

/** Abstraction (binder wrapping) shares generalization's concerns. */
export type Abstraction<A> = Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Actions<typeof Metas.registry>, A>;

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

	return (ann: NF.Value): string =>
		match(ann)
			.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => inc("type"))
			.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => inc("row"))
			.with({ type: "Lit", value: { type: "Num" } }, () => inc("num"))
			.with(NF.Patterns.Pi, () => inc("typeCtor"))
			.with(NF.Patterns.Lambda, () => inc("fun"))
			.otherwise(() => inc("any"));
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

	// Build a single closure context that has all generalized metas mapped to the corresponding bound variables.
	// We also pre-extend names/types/env so quoting inside closures sees the right level indices.
	const { ctx: extendedCtx, subst } = ms.reduce(
		(acc, m, i) => {
			const boundLvl = i + ctx.env.length; // outermost binder is the first one after the existing env
			const { annotation } = registry[m.val];

			const withBinder = EB.bind(acc.ctx, { type: "Pi", variable: getName(annotation) }, annotation, "inserted");
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
		const { annotation } = registry[m.val];
		const closureCtx = update(trimmed, "env", e => e.slice(1)); // drop the binder we are introducing now so it doesn't get captured in the closure
		return yield* wrap(NF.Constructors.Pi(variable, "Implicit", annotation, NF.Constructors.Closure(closureCtx, term)), tail, i + 1);
	};
	const generalized = yield* wrap(ty, A.reverse(ms), 0);

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
		const { annotation } = registry[m.val];
		const variable = getName(annotation);
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
		const { annotation } = registry[meta.val];
		const closureCtx = update(trimmed, "env", env => env.slice(1));
		return yield* wrap(NF.Constructors.Pi(variable, "Implicit", annotation, NF.Constructors.Closure(closureCtx, term)), tail, i + 1);
	};
	const type = yield* wrap(ty, A.reverse(entries), 0);

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

	const instantiateRow = function* (row: NF.Row): EB.Icit.Zonking<NF.Row> {
		if (row.type === "empty" || row.type === "variable") {
			return row;
		}
		return R.Constructors.Extension(row.label, yield* instantiate(row.value), yield* instantiateRow(row.row));
	};

	return yield* match(nf)
		.with({ type: "Var" }, function* (v) {
			if (v.variable.type !== "Meta") {
				return v;
			}

			if (Metas.solution(registry, v.variable.val)) {
				// Solved meta means it's not unconstrained, so no need to instantiate it
				return v;
			}

			// Don't instantiate metas from outer scopes - they should remain unsolved
			// and will be handled at their original scope level
			if (v.variable.lvl < ctx.env.length) {
				return v;
			}

			const { annotation } = registry[v.variable.val];
			return match(annotation)
				.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => NF.Constructors.Row({ type: "empty" }))
				.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => NF.Constructors.Lit({ type: "Atom", value: "Any" }))
				.otherwise(() => NF.Constructors.Var(v.variable));
		})
		.with({ type: "Lit" }, function* (lit) {
			return lit;
		})
		.with(NF.Patterns.Lambda, function* ({ binder, closure }) {
			const ann = yield* instantiate(binder.annotation);
			const xtended = EB.bind(closure.ctx, binder, ann);
			const term = yield* M.reader.local(_ => xtended, EB.Icit.instantiate(closure.term, {}));
			return NF.Constructors.Lambda(binder.variable, binder.icit, { ...closure, term }, ann);
		})
		.with(NF.Patterns.Pi, function* ({ binder, closure }) {
			const ann = yield* instantiate(binder.annotation);
			const xtended = EB.bind(closure.ctx, binder, ann);
			const term = yield* M.reader.local(_ => xtended, EB.Icit.instantiate(closure.term, {}));
			return NF.Constructors.Pi(binder.variable, binder.icit, ann, { ...closure, term });
		})
		.with(NF.Patterns.Mu, function* ({ binder, closure }) {
			const ann = yield* instantiate(binder.annotation);
			const xtended = EB.bind(closure.ctx, binder, ann);
			const term = yield* M.reader.local(_ => xtended, EB.Icit.instantiate(closure.term, {}));
			return NF.Constructors.Mu(binder.variable, binder.source, ann, { ...closure, term });
		})
		.with(NF.Patterns.Sigma, function* ({ binder, closure }) {
			const ann = yield* instantiate(binder.annotation);
			const xtended = EB.bind(closure.ctx, binder, ann);
			const term = yield* M.reader.local(_ => xtended, EB.Icit.instantiate(closure.term, {}));
			return NF.Constructors.Sigma(binder.variable, ann, { ...closure, term });
		})
		.with({ type: "App" }, function* ({ icit, func, arg }) {
			return NF.Constructors.App(yield* instantiate(func), yield* instantiate(arg), icit);
		})
		.with(NF.Patterns.Proj, function* ({ base, label }) {
			return NF.Constructors.Proj(yield* instantiate(base), label);
		})
		.with(NF.Patterns.Match, function* ({ closure, scrutinee }) {
			return NF.Constructors.Match(closure, yield* instantiate(scrutinee));
		})
		.with(NF.Patterns.Inj, function* ({ base, label, injected }) {
			return NF.Constructors.Inj(yield* instantiate(base), label, yield* instantiate(injected));
		})
		.with({ type: "Row" }, function* ({ row }) {
			return NF.Constructors.Row(yield* instantiateRow(row));
		})
		.with({ type: "Neutral" }, function* ({ kind, value }) {
			return NF.Constructors.Neutral(kind, yield* instantiate(value));
		})
		.with(NF.Patterns.Modal, function* ({ value, modalities }) {
			return NF.Constructors.Modal(yield* instantiate(value), {
				quantity: modalities.quantity,
				liquid: yield* instantiate(modalities.liquid),
			});
		})
		.otherwise(() => {
			throw new Error("Traverse: Not implemented yet");
		});
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
export const trimClosureEnvs = (nf: NF.Value): NF.Value => {
	return match(nf)
		.with({ type: "Var" }, v => v)
		.with({ type: "Lit" }, lit => lit)
		.with({ type: "Abs" }, abs => {
			const ann = trimClosureEnvs(abs.binder.annotation);
			const trimmedClosure = {
				...abs.closure,
				ctx: {
					...abs.closure.ctx,
					env: abs.closure.ctx.env.slice(0, abs.closure.ctx.env.length - 1), // Remove first entry (the recursive variable at level 0)
				},
			};
			return { ...abs, annotation: ann, closure: trimmedClosure };
		})

		.with({ type: "App" }, ({ icit, func, arg }) => NF.Constructors.App(trimClosureEnvs(func), trimClosureEnvs(arg), icit))
		.with(NF.Patterns.Proj, ({ base, label }) => NF.Constructors.Proj(trimClosureEnvs(base), label))
		.with(NF.Patterns.Match, ({ closure, scrutinee }) => NF.Constructors.Match(closure, trimClosureEnvs(scrutinee)))
		.with(NF.Patterns.Inj, ({ base, label, injected }) => NF.Constructors.Inj(trimClosureEnvs(base), label, trimClosureEnvs(injected)))
		.with({ type: "Row" }, ({ row }) =>
			NF.Constructors.Row(
				R.traverse(
					row,
					v => trimClosureEnvs(v),
					v => R.Constructors.Variable(v),
				),
			),
		)
		.with({ type: "Neutral" }, ({ kind, value }) => NF.Constructors.Neutral(kind, trimClosureEnvs(value)))
		.with(NF.Patterns.Modal, ({ value, modalities }) =>
			NF.Constructors.Modal(trimClosureEnvs(value), {
				quantity: modalities.quantity,
				liquid: trimClosureEnvs(modalities.liquid),
			}),
		)
		.with({ type: "External" }, ext => ext) // External values don't have closures to trim
		.otherwise(() => {
			throw new Error("trimClosureEnvs: Not implemented yet");
		});
};
