import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";

import * as Q from "@yap/shared/modalities/multiplicity";

import fp from "lodash/fp";
import * as F from "fp-ts/function";
import * as A from "fp-ts/Array";
import { set, update } from "@yap/utils";
import * as Sub from "../unification/substitution";
import { Liquid } from "@yap/verification/modalities";
import { collectMetasEB, collectMetasNF } from "../shared/metas";

type Meta = Extract<NF.Variable, { type: "Meta" }>;

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
export const generalize = (ty: NF.Value, tm: EB.Term, ctx: EB.Context, resolutions: EB.Resolutions): [NF.Value, EB.Context["zonker"]] => {
	const tyMetas = collectMetasNF(ty, ctx.zonker);
	const tmMetas = collectMetasEB(tm, ctx.zonker);
	const allMetas = fp.uniqBy((m: Meta) => m.val, [...tyMetas, ...tmMetas]).filter(m => !resolutions[m.val]);
	const getName = getNameFactory(mkCounters());

	// Filter out metas from outer scopes - only generalize metas created in the current scope
	// A meta's lvl indicates the context depth when it was created
	// If lvl < ctx.env.length, it was created in an outer scope and should NOT be generalized
	const ms = allMetas.filter(m => m.lvl >= ctx.env.length);

	if (ms.length === 0) {
		return [ty, ctx.zonker];
	}

	const charCode = "a".charCodeAt(0);

	// Build a single closure context that has all generalized metas mapped to the corresponding bound variables.
	// We also pre-extend names/types/env so quoting inside closures sees the right level indices.
	const extendedCtx = ms.reduce((acc, m, i) => {
		//const name = `${String.fromCharCode(charCode + i)}`;
		const boundLvl = i + ctx.env.length; // outermost binder is the first one after the existing env
		const { ann } = ctx.metas[m.val];
		const withBinder = EB.bind(acc, { type: "Pi", variable: getName(ann) }, ann, "inserted");
		return set(withBinder, ["zonker", `${m.val}`] as const, NF.Constructors.Var({ type: "Bound", lvl: boundLvl }));
	}, ctx);

	// Wrap from inner to outer. Each Pi body is quoted with lvl equal to the number of binders in scope.
	const generalized = A.reverse(ms).reduce<NF.Value>((body, m, i) => {
		const idx = ms.length - 1 - i; // the idx is the complement of i, since we're going from inner to outer
		//const variable = String.fromCharCode(charCode + idx);
		// Quote with all binders in scope: lvl = ms.length - i
		const variable = extendedCtx.env[i].name.variable;
		const trimmed = update(extendedCtx, "env", e => e.slice(i)); // trim the already introduced binders from the env for quoting
		const term = NF.quote(trimmed, ctx.env.length + ms.length - i, body);
		const { ann } = ctx.metas[m.val];

		const closureCtx = update(trimmed, "env", e => e.slice(1)); // drop the binder we are introducing now so it doesn't get captured in the closure
		return NF.Constructors.Pi(variable, "Implicit", ann, NF.Constructors.Closure(closureCtx, term));
	}, ty);

	// Return the context with updated zonker
	return [generalized, extendedCtx.zonker];
};

/**
 * Instantiates unconstrained meta variables in a Normal Form (NF) to default values based on their annotations.
 * Constrained metas (those that have been unified to some value) are left alone.
 * Metas from outer scopes (lvl < ctx.env.length) are also left alone - they will be solved at their original scope.
 */
export const instantiate = (nf: NF.Value, ctx: EB.Context): NF.Value => {
	return match(nf)
		.with({ type: "Var" }, v => {
			if (v.variable.type !== "Meta") {
				return v;
			}

			if (!!ctx.zonker[v.variable.val]) {
				// Solved meta means it's in the zonker = not unconstrained, so no need to instantiate it
				return v;
			}

			// Don't instantiate metas from outer scopes - they should remain unsolved
			// and will be handled at their original scope level
			if (v.variable.lvl < ctx.env.length) {
				return v;
			}

			const { ann } = ctx.metas[v.variable.val];
			return match(ann)
				.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => NF.Constructors.Row({ type: "empty" }))
				.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => NF.Constructors.Lit({ type: "Atom", value: "Any" }))
				.otherwise(() => NF.Constructors.Var(v.variable));
		})
		.with({ type: "Lit" }, lit => lit)
		.with(NF.Patterns.Lambda, ({ binder, closure }) => {
			const ann = instantiate(binder.annotation, ctx);
			const xtended = F.pipe(
				EB.bind(closure.ctx, binder, ann),
				update("zonker", z => Sub.compose(ctx.zonker, z)),
				update("metas", m => ({ ...ctx.metas, ...m })),
			);
			return NF.Constructors.Lambda(
				binder.variable,
				binder.icit,
				update(closure, "term", t => EB.Icit.instantiate(t, xtended, {})),
				ann,
			);
		})
		.with(NF.Patterns.Pi, ({ binder, closure }) => {
			const ann = instantiate(binder.annotation, ctx);
			const xtended = F.pipe(
				EB.bind(closure.ctx, binder, ann),
				update("zonker", z => Sub.compose(ctx.zonker, z)),
				update("metas", m => ({ ...ctx.metas, ...m })),
			);
			return NF.Constructors.Pi(
				binder.variable,
				binder.icit,
				ann,
				update(closure, "term", t => EB.Icit.instantiate(t, xtended, {})),
			);
		})
		.with(NF.Patterns.Mu, ({ binder, closure }) => {
			const ann = instantiate(binder.annotation, ctx);
			const xtended = F.pipe(
				EB.bind(closure.ctx, binder, ann),
				update("zonker", z => Sub.compose(ctx.zonker, z)),
				update("metas", m => ({ ...ctx.metas, ...m })),
			);
			return NF.Constructors.Mu(
				binder.variable,
				binder.source,
				ann,
				update(closure, "term", t => EB.Icit.instantiate(t, xtended, {})),
			);
		})
		.with(NF.Patterns.Sigma, ({ binder, closure }) => {
			const ann = instantiate(binder.annotation, ctx);
			const xtended = F.pipe(
				EB.bind(closure.ctx, binder, ann),
				update("zonker", z => Sub.compose(ctx.zonker, z)),
				update("metas", m => ({ ...ctx.metas, ...m })),
			);
			return NF.Constructors.Sigma(
				binder.variable,
				ann,
				update(closure, "term", t => EB.Icit.instantiate(t, xtended, {})),
			);
		})
		.with({ type: "App" }, ({ icit, func, arg }) => NF.Constructors.App(instantiate(func, ctx), instantiate(arg, ctx), icit))
		.with({ type: "Row" }, ({ row }) =>
			NF.Constructors.Row(
				R.traverse(
					row,
					v => instantiate(v, ctx),
					v => R.Constructors.Variable(v),
				),
			),
		)
		.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(instantiate(value, ctx)))
		.with(NF.Patterns.Modal, ({ value, modalities }) =>
			NF.Constructors.Modal(instantiate(value, ctx), {
				quantity: modalities.quantity,
				liquid: instantiate(modalities.liquid, ctx),
			}),
		)
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
		.with({ type: "Row" }, ({ row }) =>
			NF.Constructors.Row(
				R.traverse(
					row,
					v => trimClosureEnvs(v),
					v => R.Constructors.Variable(v),
				),
			),
		)
		.with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(trimClosureEnvs(value)))
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
