import { match, P } from "ts-pattern";
import _ from "lodash";

import * as O from "fp-ts/Option";
import * as F from "fp-ts/function";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Sub from "./substitution";
import { Subst } from "./substitution";

import * as Err from "@yap/elaboration/shared/errors";
import * as R from "@yap/shared/rows";

import { update } from "@yap/utils";

import * as Row from "@yap/elaboration/unification/rows";

export const unify = (left: NF.Value, right: NF.Value, lvl: number, subst: Subst): V2.Elaboration<Subst> => {
	if (left.type === "Neutral") {
		return unify(left.value, right, lvl, subst);
	}

	if (right.type === "Neutral") {
		return unify(left, right.value, lvl, subst);
	}

	return V2.track(
		{ tag: "unify", type: "nf", vals: [left, right], metadata: { action: "unification" } },
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const [l, r] = [NF.force(ctx, left), NF.force(ctx, right)];
			// Force wraps unsolved metas in a Neutral, so we need to unwrap them again.
			// TODO: check if we can remove the wrapping in Force.
			const unifier = match([NF.unwrapNeutral(l), NF.unwrapNeutral(r)])
				.with([NF.Patterns.Flex, NF.Patterns.Flex], ([meta1, meta2]) =>
					V2.Do<Subst, Subst>(function* () {
						const s = Sub.compose(bind(ctx, meta1.variable, meta2), subst);

						const ann1 = ctx.metas[meta1.variable.val].ann;
						const ann2 = ctx.metas[meta2.variable.val].ann;
						const s1 = yield* unify.gen(ann1, ann2, lvl, s);
						return s1;
					}),
				)
				.with(
					[NF.Patterns.Flex, P._],
					([{ variable }]) => !!subst[variable.val],
					([meta, v]) => unify(subst[meta.variable.val], v, lvl, subst),
				)
				.with(
					[P._, NF.Patterns.Flex],
					([v, { variable }]) => !!subst[variable.val],
					([v, meta]) => unify(v, subst[meta.variable.val], lvl, subst),
				)
				.with([NF.Patterns.Flex, P._], ([meta, v]) => V2.of(Sub.compose(bind(ctx, meta.variable, v), subst)))
				.with([P._, NF.Patterns.Flex], ([v, meta]) => V2.of(Sub.compose(bind(ctx, meta.variable, v), subst)))
				.with([NF.Patterns.Lit, NF.Patterns.Lit], ([lit1, lit2]) =>
					V2.Do<Subst, Subst>(function* () {
						if (!_.isEqual(lit1.value, lit2.value)) {
							return yield* V2.fail(Err.UnificationFailure(lit1, lit2));
						}
						return subst;
					}),
				)
				.with([NF.Patterns.Modal, P._], ([{ value }, val]) => unify(value, val, lvl, subst))
				.with([P._, NF.Patterns.Modal], ([val, { value }]) => unify(val, value, lvl, subst))
				.with(
					[NF.Patterns.Lambda, NF.Patterns.Lambda],
					([lam1, lam2]) => lam1.binder.icit === lam2.binder.icit,
					([lam1, lam2]) =>
						V2.Do<Subst, Subst>(function* () {
							const body1 = NF.apply(lam1.binder, lam1.closure, NF.Constructors.Rigid(lvl));
							const body2 = NF.apply(lam2.binder, lam2.closure, NF.Constructors.Rigid(lvl));
							return yield unify(body1, body2, lvl + 1, subst);
						}),
				)
				.with(
					[NF.Patterns.Pi, NF.Patterns.Pi],
					([pi1, pi2]) => pi1.binder.icit === pi2.binder.icit,
					([pi1, pi2]) =>
						V2.Do(function* () {
							const sub = yield* V2.pure(unify(pi1.binder.annotation, pi2.binder.annotation, lvl, subst));
							const composed = Sub.compose(sub, subst);
							const body1 = NF.apply(pi1.binder, pi1.closure, NF.Constructors.Rigid(lvl));
							const body2 = NF.apply(pi2.binder, pi2.closure, NF.Constructors.Rigid(lvl));
							return yield* V2.pure(unify(body1, body2, lvl + 1, composed));
						}),
				)
				.with([NF.Patterns.Mu, NF.Patterns.Mu], ([mu1, mu2]) =>
					V2.Do(function* () {
						const sub = yield* V2.pure(unify(mu1.binder.annotation, mu2.binder.annotation, lvl, subst));
						const composed = Sub.compose(sub, subst);
						const body1 = NF.apply(mu1.binder, mu1.closure, NF.Constructors.Rigid(lvl));
						const body2 = NF.apply(mu2.binder, mu2.closure, NF.Constructors.Rigid(lvl));
						return yield* V2.pure(unify(body1, body2, lvl + 1, composed));
					}),
				)
				.with([P._, NF.Patterns.Mu], ([v, mu]) =>
					V2.Do(function* () {
						const unfolded = NF.apply(mu.binder, mu.closure, mu);
						return yield* V2.local(ctx => EB.unfoldMu(ctx, { type: "Mu", variable: mu.binder.variable }, mu), unify(v, unfolded, lvl + 1, subst));
					}),
				)
				.with([NF.Patterns.Mu, P._], ([mu, v]) =>
					V2.Do(function* () {
						const unfolded = NF.apply(mu.binder, mu.closure, mu);
						return yield* V2.local(ctx => EB.unfoldMu(ctx, { type: "Mu", variable: mu.binder.variable }, mu), unify(unfolded, v, lvl + 1, subst));
					}),
				)
				.with([NF.Patterns.Rigid, NF.Patterns.Rigid], ([rigid1, rigid2]) =>
					V2.Do<Subst, Subst>(function* () {
						if (!_.isEqual(rigid1.variable, rigid2.variable)) {
							return yield* V2.fail(Err.RigidVariableMismatch(rigid1, rigid2));
						}
						return subst;
					}),
				)
				.with(
					[NF.Patterns.Schema, NF.Patterns.Schema],
					[NF.Patterns.Struct, NF.Patterns.Struct],
					[NF.Patterns.Variant, NF.Patterns.Variant],
					([left, right]) => {
						return unify(left.arg, right.arg, lvl, subst);
					},
				)
				.with([NF.Patterns.Indexed, NF.Patterns.Indexed], ([left, right]) =>
					V2.Do<Subst, Subst>(function* () {
						const o1 = yield unify(left.func.func.arg, right.func.func.arg, lvl, subst);
						const o2 = yield unify(left.func.arg, right.func.arg, lvl, o1);
						const o3 = yield unify(left.arg, right.arg, lvl, o2);
						return o3;
					}),
				)
				.with([NF.Patterns.Recursive, NF.Patterns.Recursive], ([left, right]) =>
					V2.Do<Subst, Subst>(function* () {
						const o1 = yield unify(left.func, right.func, lvl, subst);
						const o2 = yield unify(left.arg, right.arg, lvl, o1);
						return o2;
					}),
				)
				.with([NF.Patterns.App, NF.Patterns.App], ([left, right]) =>
					V2.Do<Subst, Subst>(function* () {
						const unfoldedL = unfoldMu(left);
						const unfoldedR = unfoldMu(right);

						// NOTE: Using reference equality to check if unfolding made a change. Unfolding returns the same object if no unfolding was done.
						if (O.isNone(unfoldedL) && O.isNone(unfoldedR)) {
							const o1 = yield unify(left.func, right.func, lvl, subst);
							const o2 = yield unify(left.arg, right.arg, lvl, o1);
							return o2;
						}

						const sub = yield unify(
							F.pipe(
								unfoldedL,
								O.getOrElse<NF.Value>(() => left),
							),
							F.pipe(
								unfoldedR,
								O.getOrElse<NF.Value>(() => right),
							),
							lvl,
							subst,
						);
						return sub;
						// 	.with(
						// 		[NF.Patterns.Mu, P._],
						// 		([, v]) => v.type !== "Abs" || v.binder.type !== "Mu",
						// 		([mu, v]) => {
						// 			const unfolded = NF.apply(mu.binder, mu.closure, mu);
						// 			const applied = NF.reduce(unfolded, left.arg, "Explicit");
						// 			return unify(applied, right, lvl, subst);
						// 		},
						// 	)
						// 	.with(
						// 		[P._, NF.Patterns.Mu],
						// 		([v]) => v.type !== "Abs" || v.binder.type !== "Mu",
						// 		([v, mu]) => {
						// 			const unfolded = NF.apply(mu.binder, mu.closure, mu);
						// 			const applied = NF.reduce(unfolded, right.arg, "Explicit");
						// 			return unify(left, applied, lvl, subst);
						// 		},
						// 	)
						// 	.otherwise(() =>
						// 		V2.Do(function* () {
						// 			const o1 = yield* V2.pure(unify(left.func, right.func, lvl, subst));
						// 			const o2 = yield* V2.pure(unify(left.arg, right.arg, lvl, o1));
						// 			return Sub.compose(o2, o1);
						// 		}),
						// 	);
					}),
				)
				.with(
					[NF.Patterns.App, P._],
					([app]) => O.isSome(unfoldMu(app)),
					([app, v]) => {
						const unfolded = unfoldMu(app);
						return unify(
							F.pipe(
								unfolded,
								O.getOrElse<NF.Value>(() => app),
							),
							v,
							lvl,
							subst,
						);
					},
				)
				.with(
					[P._, NF.Patterns.App],
					([, app]) => O.isSome(unfoldMu(app)),
					([v, app]) => {
						const unfolded = unfoldMu(app);
						return unify(
							v,
							F.pipe(
								unfolded,
								O.getOrElse<NF.Value>(() => app),
							),
							lvl,
							subst,
						);
					},
				)

				.with([NF.Patterns.Row, NF.Patterns.Row], ([{ row: r1 }, { row: r2 }]) =>
					V2.Do(function* () {
						const sub = yield* Row.unify.gen(r1, r2, subst);
						return Sub.compose(sub, subst);
					}),
				)
				.with(
					// NOTE: Foreign variables are not strictly α-equivalent, but they get shadowed, so we can assume this is somewhat sound
					// ideally we'll want fully qualified names, but that's not yet implemented
					// SOLUTION: fully qualified names
					[
						{ type: "Var", variable: { type: "Foreign" } },
						{ type: "Var", variable: { type: "Foreign" } },
					],
					([ffi1, ffi2]) => ffi1.variable.name === ffi2.variable.name,
					() => V2.of(subst),
				)
				.otherwise(ts => {
					return V2.Do<Subst, unknown>(() => V2.fail(Err.TypeMismatch(left, right)));
				});

			const sub = yield* V2.pure(unifier);
			return Sub.compose(sub, subst);
		}),
	);
};

unify.gen = (left: NF.Value, right: NF.Value, lvl: number, subst: Subst) => V2.pure(unify(left, right, lvl, subst));

const unfoldMu = (app: Extract<NF.Value, { type: "App" }>): O.Option<NF.Value> => {
	const { func, arg, icit } = app;
	return (
		match(func)
			.with({ type: "App" }, fn =>
				F.pipe(
					unfoldMu(fn),
					O.map(f => NF.reduce(f, arg, icit)),
				),
			)
			// 	const unfolded = unfoldMu(fn);
			// 	return O.Functor.map(unfolded, f => NF.reduce(f, arg, icit));
			// 	//return NF.reduce(unfolded, arg, icit);
			// })
			.with({ type: "Abs", binder: { type: "Mu" } }, mu => {
				const body = NF.apply(mu.binder, mu.closure, mu);
				const unfolded = NF.reduce(body, arg, icit);
				return O.some(unfolded);
			})
			.otherwise(() => O.none)
	);
};

type Meta = Extract<EB.Variable, { type: "Meta" }>;
export const bind = (ctx: EB.Context, v: Meta, ty: NF.Value): Subst => {
	if (ty.type === "Var" && _.isEqual(ty.variable, v)) {
		return Sub.empty;
	}

	if (!occursCheck(ctx, v, ty)) {
		// if (ty.type === "Abs") {
		// 	// NOTE: Pruning the environment to the level of the variable
		// 	// Because closures capture the environment during elaboration, we ensure only the necessary variables are captured here
		// 	// when unifying with a meta generated at a certain, lower level.
		// 	// The other way around is not a problem, since the closure env already contains all the strictly necessary variables.

		// 	// This is not an ideal solution, as it demands that metas contain the level at which they were generated.
		// 	// An alternative would be higher-order unification, which is more complex to implement, but more powerful.
		// 	//const _ty = { ...ty, closure: { ...ty.closure, env: ty.closure.env.slice(-v.lvl) } };
		// 	const _ty = update(ty, "closure.ctx", ctx => EB.prune(ctx, v.lvl));
		// 	return Sub.of(v.val, _ty);
		// }
		// IMPORTANT: Do not prune closure environments here.
		// Pruning the captured environment (e.g., to the meta's level) invalidates
		// de Bruijn indices inside the closure.term, which were quoted relative to the
		// original captured context. That leads to misindexed variables (e.g., `x`
		// turning into `incf`) and missing binders (like a local `tmp`).
		// If restricting environments becomes necessary, we must also reindex the term,
		// which we don't currently support. So we keep closures as captured during elaboration.

		// Pruning was meant to avoid escaping binders in the meta solution. (out of scope errors)
		// TODO: Either generalize over the escaped binder, or implement higher-order unification.
		return Sub.of(v.val, ty);
	}

	// solution is a mu type
	throw new Error("Unification: Occurs check failed. Need to implement mu type");
};

const occursCheck = (ctx: EB.Context, v: Meta, ty: NF.Value): boolean => {
	return (
		match(ty)
			.with(NF.Patterns.Var, ({ variable }) => _.isEqual(variable, v))
			.with({ type: "Neutral" }, ({ value }) => occursCheck(ctx, v, value))
			//occursCheck(ctx, v, NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length))))
			.with(NF.Patterns.Lambda, ({ binder, closure }) => occursInTerm(closure.ctx, v, closure.term))
			//occursCheck(ctx, v, NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length))))
			.with(NF.Patterns.Pi, ({ binder, closure }) => occursInTerm(closure.ctx, v, closure.term))
			.with(NF.Patterns.App, ({ func, arg }) => occursCheck(ctx, v, func) || occursCheck(ctx, v, arg))
			.with(NF.Patterns.Modal, ({ value, modalities }) => occursCheck(ctx, v, value) || occursCheck(ctx, v, modalities.liquid))

			.with(NF.Patterns.Row, ({ row }) =>
				R.fold(
					row,
					(nf, _, acc) => acc || occursCheck(ctx, v, nf),
					rv => rv.type === "Meta" && _.isEqual(rv, v),
					false,
				),
			)
			.otherwise(() => false)
	);
};

const occursInTerm = (ctx: EB.Context, v: Meta, tm: EB.Term): boolean => {
	return (
		match(tm)
			.with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) => {
				if (ctx.zonker[variable.val]) {
					return occursCheck(ctx, v, ctx.zonker[variable.val]);
				}
				return _.isEqual(variable, v);
			})
			.with({ type: "Abs" }, ({ binding, body }) => occursInTerm(ctx, v, binding.annotation) || occursInTerm(ctx, v, body))
			.with({ type: "App" }, ({ func, arg }) => occursInTerm(ctx, v, func) || occursInTerm(ctx, v, arg))
			//.with({ type: "Annotation" }, ({ term, ann }) => occursInTerm(ctx, v, term) || occursInTerm(ctx, v, ann))
			.with({ type: "Match" }, ({ scrutinee, alternatives }) => occursInTerm(ctx, v, scrutinee) || alternatives.some(({ term }) => occursInTerm(ctx, v, term)))
			.with({ type: "Block" }, ({ return: ret, statements }) => occursInTerm(ctx, v, ret) || statements.some(s => occursInTerm(ctx, v, s.value)))
			.with({ type: "Row" }, ({ row }) =>
				R.fold(
					row,
					(nf, _, acc) => acc || occursInTerm(ctx, v, nf),
					rv => {
						if (rv.type === "Meta" && ctx.zonker[rv.val]) {
							return occursCheck(ctx, v, ctx.zonker[rv.val]);
						}
						return _.isEqual(rv, v);
					},
					false,
				),
			)
			.with({ type: "Proj" }, ({ term }) => occursInTerm(ctx, v, term))
			.with({ type: "Inj" }, ({ value, term }) => occursInTerm(ctx, v, value) || occursInTerm(ctx, v, term))
			.with({ type: "Lit" }, () => false)
			.with({ type: "Modal" }, ({ term }) => occursInTerm(ctx, v, term))
			.otherwise(() => false)
	);
};
