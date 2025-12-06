import assert from "assert";
import { match, P } from "ts-pattern";
import { isEqual } from "lodash";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as O from "fp-ts/Option";
import * as Row from "@yap/shared/rows";
import * as E from "fp-ts/Either";
import * as F from "fp-ts/function";
import * as Q from "@yap/shared/modalities/multiplicity";

import type { Context as Z3Context, Expr, Bool } from "z3-solver";

import { Liquid } from "../modalities";
import { extractModalities, isFirstOrder, type ExtractModalitiesFn } from "./utils/refinements";
import { noCapture } from "./utils/context";
import type { VerificationRuntime } from "./utils/context";
import type { TranslationTools } from "./logic/translate";
import type { SubtypeFn, VerificationResult } from "./types";

type SubtypeDeps = {
	Z3: Z3Context<"main">;
	runtime: VerificationRuntime;
	translation: TranslationTools;
};

export const createSubtype = ({ Z3, runtime, translation }: SubtypeDeps) => {
	const { translate, mkSort, quantify, build } = translation;

	const subtype = (left: NF.Value, right: NF.Value): VerificationResult<Expr> =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			runtime.enter();
			runtime.log("Subtyping:", EB.Display.Env(ctx), NF.display(left, ctx, { deBruijn: true }), "<:", NF.display(right, ctx, { deBruijn: true }));

			const result = match([NF.unwrapNeutral(left), NF.unwrapNeutral(right)])
				/* ***************************************************************************************
				 * **Basic subtyping rules**
				 *
				 * - Literal equality
				 * - Rigid variable equality
				 * - Row and Indexed types subtyping
				 * - Identical mu-types
				 * - Identical recursive mu applications
				 * - Pi-type subtyping (contravariant in the argument, covariant in the result)
				 *
				 * * All of these rules can be immediately discharged as the types are structurally identical
				 * ***************************************************************************************/
				.with([NF.Patterns.Lit, NF.Patterns.Lit], ([{ value: v1 }, { value: v2 }]) => V2.of(Z3.Bool.val(isEqual(v1, v2))))
				.with([NF.Patterns.Rigid, NF.Patterns.Rigid], ([rigid1, rigid2]) => {
					if (rigid1.variable.lvl === rigid2.variable.lvl) {
						return V2.of(Z3.Bool.val(true));
					}
					throw new Error("Rigid variables do not match in subtype");
				})
				.with([NF.Patterns.Row, NF.Patterns.Row], ([a, b]) => contains(b.row, a.row))
				.with([NF.Patterns.Indexed, NF.Patterns.Indexed], ([a, b]) => {
					const domainA = a.func.func.arg;
					const codomainA = a.func.arg;
					const domainB = b.func.func.arg;
					const codomainB = b.func.arg;
					return V2.Do(function* () {
						// QUESTION: do we need to apply contravariance on the domain?
						const vcDom = yield* subtype.gen(domainA, domainB);
						const vcCod = yield* subtype.gen(codomainA, codomainB);
						return Z3.And(vcDom as Bool, vcCod as Bool);
					});
				})
				.with([NF.Patterns.Schema, NF.Patterns.HashMap.value], ([schema, hashmap]) => {
					const codomain = hashmap.func.arg;
					return Row.fold(
						schema.arg.row,
						(val, lbl, acc) =>
							V2.Do(function* () {
								const vc = yield* subtype.gen(val, codomain);
								const unwrapped = yield* V2.pure(acc);
								return Z3.And(unwrapped, vc as Bool);
							}),
						(_, acc) => acc,
						V2.of<Bool>(Z3.Bool.val(true)),
					);
				})
				.with([NF.Patterns.Sigma, NF.Patterns.Sigma], ([a, b]) =>
					V2.Do(function* () {
						const vc = yield* subtype.gen(a.binder.annotation, b.binder.annotation);
						const bodyA = NF.apply(a.binder, a.closure, a.binder.annotation);
						const bodyB = NF.apply(b.binder, b.closure, b.binder.annotation);
						const vcBody = yield* subtype.gen(bodyA, bodyB);
						return Z3.And(vc as Bool, vcBody as Bool);
					}),
				)
				.with([NF.Patterns.Schema, NF.Patterns.Sigma], ([schema, sig]) => {
					const body = NF.apply(sig.binder, sig.closure, NF.Constructors.Row(schema.arg.row));
					return subtype(schema, body);
				})
				.with([NF.Patterns.Sigma, NF.Patterns.Schema], ([sig, schema]) => {
					const body = NF.apply(sig.binder, sig.closure, NF.Constructors.Row(schema.arg.row));
					return subtype(body, schema);
				})
				.with([NF.Patterns.Schema, NF.Patterns.Schema], ([{ arg: a }, { arg: b }]) => contains(b.row, a.row))
				.with([NF.Patterns.Variant, NF.Patterns.Variant], ([{ arg: a }, { arg: b }]) => contains(b.row, a.row))
				.with([NF.Patterns.Mu, NF.Patterns.Mu], ([mu1, mu2]) =>
					V2.Do(function* () {
						const arg = yield* subtype.gen(mu1.binder.annotation, mu2.binder.annotation);
						const body1 = NF.apply(mu1.binder, mu1.closure, NF.Constructors.Rigid(ctx.env.length));
						const body2 = NF.apply(mu2.binder, mu2.closure, NF.Constructors.Rigid(ctx.env.length));
						const body = yield* V2.local(ctx => EB.bind(ctx, mu2.binder, mu2.binder.annotation), subtype(body1, body2));
						return Z3.And(arg as Bool, body as Bool);
					}),
				)
				.with([NF.Patterns.Recursive, NF.Patterns.Recursive], ([left, right]) =>
					V2.Do<Expr, Expr>(function* () {
						const vc1 = yield subtype(left.func, right.func);
						const vc2 = yield subtype(left.arg, right.arg);
						return Z3.And(vc1 as Bool, vc2 as Bool);
					}),
				)
				.with([NF.Patterns.Pi, NF.Patterns.Pi], [NF.Patterns.Lambda, NF.Patterns.Lambda], ([at, bt]) =>
					V2.Do(function* () {
						const vcArg = yield* subtype.gen(bt.binder.annotation, at.binder.annotation);
						const envCtx = yield* V2.ask();
						const lvl = envCtx.env.length;
						const anf = NF.apply(at.binder, at.closure, NF.Constructors.Rigid(lvl));
						const bnf = NF.apply(bt.binder, bt.closure, NF.Constructors.Rigid(lvl));
						const vcBody = yield* V2.local(ctx => EB.bind(ctx, bt.binder, bt.binder.annotation), subtype(anf, bnf));

						if (!isFirstOrder(bt.binder.annotation)) {
							runtime.record("subtype.pi.nonrefinable", vcBody as Bool, {
								type: `${NF.display(at, envCtx)} <: ${NF.display(bt, envCtx)}`,
								description: `Function result must be subtype (non-refinable parameter ${bt.binder.variable})`,
							});
							return Z3.And(vcArg as Bool, vcBody as Bool);
						}

						const sortMap = mkSort(bt.binder.annotation, envCtx);
						const xSort = match(sortMap)
							.with({ Prim: P.select() }, p => p)
							.with({ Recursive: P.select() }, r => r)
							.with({ Row: P.select() }, r => r)
							.with({ App: P._ }, app => {
								const sorts = build(app);
								return Z3.Sort.declare(`App_${sorts.map(s => s.name()).join("_")}`);
							})
							.otherwise(() => {
								throw new Error("Only primitive types can be used in logical formulas");
							});
						const x = Z3.Const(bt.binder.variable, xSort);

						const modalities = extractModalities(bt.binder.annotation, envCtx);
						if (modalities.liquid.type !== "Abs") {
							throw new Error("Liquid refinement must be a unary function");
						}
						const applied = NF.apply(modalities.liquid.binder, modalities.liquid.closure, NF.Constructors.Rigid(lvl));
						const phiX = translate(applied, envCtx, { [lvl]: x }) as Bool;

						const guarded = runtime.record("subtype.pi.body", Z3.ForAll([x], Z3.Implies(phiX, vcBody as Bool)) as Bool, {
							type: `${NF.display(at, envCtx)} <: ${NF.display(bt, envCtx)}`,
							description: `Function result must be subtype under parameter ${bt.binder.variable} assumption`,
						});
						runtime.record("subtype.pi.param", vcArg as Bool, {
							type: `${NF.display(bt.binder.annotation, envCtx)} <: ${NF.display(at.binder.annotation, envCtx)}`,
							description: "Function parameter types (contravariant)",
						});
						return Z3.And(vcArg as Bool, guarded as Bool);
					}),
				)

				/* ***************************************************************************************
				 * **Existentials**
				 *
				 * We need to eliminate existentials by extending the context with a fresh variable before applying modal subtyping
				 * This allows quantifying the resulting VC over the internalized existential witnesses from function applications
				 * Applying modal subtyping without this context extension would lead to incorrect VCs as the witnessed variables would not be in scope
				 * ***************************************************************************************/
				.with([{ type: "Existential" }, P._], ([sig, ty]) =>
					V2.Do(function* () {
						const res = yield* V2.local(
							ctx => EB.bind(ctx, { type: "Pi", variable: sig.variable }, sig.annotation),
							V2.Do(function* () {
								const xtended = yield* V2.ask();
								const vc = yield* subtype.gen(sig.body.value, ty);
								return quantify(sig.variable, sig.annotation, vc, xtended);
							}),
						);
						return res;
					}),
				)
				.with([P._, { type: "Existential" }], ([ty, sig]) =>
					V2.Do(() =>
						V2.local(
							ctx => EB.bind(ctx, { type: "Pi", variable: sig.variable }, sig.annotation),
							V2.Do(function* () {
								const vc = yield* subtype.gen(ty, sig.body.value);
								return vc;
							}),
						),
					),
				)

				/* ***************************************************************************************
				 * **Modal subtyping rules**
				 *
				 * Generates VCs which quantify over an implication constrain (in the direction of the subtype relation) between the liquid refinements of both types
				 *
				 * * We first apply the rule when both sides are modal. This is the base case.
				 * * Then we apply weakening rules by lifting non-modal types to modal types with neutral refinements
				 *
				 * This allows chaining modal subtyping with other subtyping rules more easily
				 *
				 * //NOTE: Modal lifting much be done before mu-type unfolding to avoid infinite loops.
				 * If the modal is itself a mu-type, the unfolding rule would match first and never reach the modal lifting rule.
				 * ***************************************************************************************/
				.with([{ type: "Modal" }, { type: "Modal" }], ([at, bt]) =>
					V2.Do(function* () {
						const ctx = yield* V2.ask();
						// 1) Base type subtyping VC (ensures underlying types are compatible)
						const baseVc = yield* subtype.gen(at.value, bt.value);

						// 2) Evaluate both liquid predicates to NF.Abs under the current context
						const pAt = at.modalities.liquid;
						const pBt = bt.modalities.liquid;
						if (pAt.type !== "Abs" || pBt.type !== "Abs") {
							throw new Error("Liquid refinements must be unary functions");
						}

						// 3) Apply both to a fresh rigid at the current level (no context extension)
						const lvl = ctx.env.length;
						const appliedAt = NF.apply(pAt.binder, pAt.closure, NF.Constructors.Rigid(lvl));
						const appliedBt = NF.apply(pBt.binder, pBt.closure, NF.Constructors.Rigid(lvl));

						const sortMap = mkSort(at.value, ctx);
						const xSort = match(sortMap)
							.with({ Prim: P.select() }, p => p)
							.with({ Row: P.select() }, r => r)
							.with({ App: P._ }, app => {
								const sorts = build(app);
								return Z3.Sort.declare(`App_${sorts.map(s => s.name()).join("_")}`);
							})
							.otherwise(() => {
								runtime.log("Subtype Modal A Type:\n", NF.display(at, ctx));
								runtime.log("Subtype Modal B Type:\n", NF.display(bt, ctx));
								throw new Error("Only primitive types can be used in logical formulas");
							});

						const x = Z3.Const(pAt.binder.variable, xSort);

						// 4) Translate with a rigids map so the fresh rigid maps to the quantifier
						// TODO:FIXME: Use free variables instead of rigids. Add a new translation environment for them in the context
						const rigids = { [lvl]: x } as Record<number, Expr>;
						const phiAt = translate(appliedAt, ctx, rigids) as Bool;
						const phiBt = translate(appliedBt, ctx, rigids) as Bool;

						const forall: Bool = Z3.ForAll([x], Z3.Implies(phiAt, phiBt));
						return Z3.And(baseVc as Bool, forall);
					}),
				)
				.with([{ type: "Modal" }, P._], ([at, bt]) =>
					subtype(at, NF.Constructors.Modal(bt, { quantity: Q.Zero, liquid: Liquid.Predicate.NeutralNF(bt, noCapture(ctx)) })),
				)
				.with([P._, { type: "Modal" }], ([at, bt]) =>
					subtype(NF.Constructors.Modal(at, { quantity: Q.Many, liquid: Liquid.Predicate.NeutralNF(at, noCapture(ctx)) }), bt),
				)

				/* ***************************************************************************************
				 * **Mu-type unfolding rules**
				 *
				 * 1. Unfold mu-types on either side of the subtype relation.
				 * We've already handled the case where both sides are mu-types in the basic subtyping rules.
				 * Thus, we must unfold here to progress.
				 *
				 * 2. Unfold blocked mu-types in `App` spines.
				 * Most commonly, when applying subtyping on a mu body, the recursive application will be a "blocked" app (i.e. some rigid referring to the mu binder applied to some other type).
				 * We check if the case and unfold if needed, continuing subtyping on the unfolded type.
				 * If no unfolding is needed, we can continue with regular subtyping on the `App`.
				 *
				 * 3. At this point, if either side is still an `App`, it might also contain a blocked mu-type in its spine.
				 * We check for that case and unfold the mu-type if present, much like in (2).
				 * This ensures we can always make progress when mu-types are involved in `App` spines.
				 *
				 * // NOTE: If elaboration/unification didn't diverge, then verification must not diverge either.
				 * We thus assume that unfolding mu-types will always lead to progress in subtyping.
				 * Might be useful to add a fuel parameter here to be sure and throw an error, which would point to some mismatch between elaboration and verification.
				 *
				 * ***************************************************************************************/
				.with([NF.Patterns.Mu, P._], ([mu, ty]) =>
					V2.Do(function* () {
						const unfolded = NF.apply(mu.binder, mu.closure, mu);
						return yield* subtype.gen(unfolded, ty);
					}),
				)
				.with([P._, NF.Patterns.Mu], ([ty, mu]) =>
					V2.Do(function* () {
						const unfolded = NF.apply(mu.binder, mu.closure, mu);
						return yield* subtype.gen(ty, unfolded);
					}),
				)
				.with([NF.Patterns.App, NF.Patterns.App], ([left, right]) =>
					V2.Do<Expr, Expr>(function* () {
						const unfoldedL = NF.unfoldMu(left);
						const unfoldedR = NF.unfoldMu(right);

						if (O.isNone(unfoldedL) && O.isNone(unfoldedR)) {
							const vc1 = yield subtype(left.func, right.func);
							const vc2 = yield subtype(left.arg, right.arg);
							return Z3.And(vc1 as Bool, vc2 as Bool);
						}

						const vc = yield subtype(
							F.pipe(
								unfoldedL,
								O.getOrElse<NF.Value>(() => left),
							),
							F.pipe(
								unfoldedR,
								O.getOrElse<NF.Value>(() => right),
							),
						);
						return vc;
					}),
				)

				.with(
					[P._, NF.Patterns.App],
					([, ty]) => O.isSome(NF.unfoldMu(ty)),
					([ty, folded]) => {
						const unfolded = NF.unfoldMu(folded);
						assert(unfolded._tag === "Some");
						return subtype(ty, unfolded.value);
					},
				)
				.with(
					[NF.Patterns.App, P._],
					([ty]) => O.isSome(NF.unfoldMu(ty)),
					([folded, ty]) => {
						const unfolded = NF.unfoldMu(folded);
						assert(unfolded._tag === "Some");
						return subtype(unfolded.value, ty);
					},
				)

				/* ***************************************************************************************
				 * **Meta-variable instantiation rules**
				 *
				 * Simply instantiates meta-variables via zonker lookup and solving the resulting subtype relation
				 *
				 * Since verification occurs after elaboration, all meta-variables should be bound at this point
				 * The error case thus indicates a bug in the elaboration or normalization phases
				 *
				 * //QUESTION:TODO: Simply use `NF.force` before running pattern matching?
				 * ***************************************************************************************/
				.with([NF.Patterns.Flex, P._], ([meta, t]) => {
					const ty = ctx.zonker[meta.variable.val];
					if (!ty) {
						throw new Error("Unbound meta variable in subtype");
					}
					return subtype(ty, t);
				})
				.with([P._, NF.Patterns.Flex], ([t, meta]) => {
					const ty = ctx.zonker[meta.variable.val];
					if (!ty) {
						throw new Error("Unbound meta variable in subtype");
					}
					return subtype(t, ty);
				})

				/* ***************************************************************************************
				 * **Bound variable lookup rules**
				 *
				 * Looks up the bound variable in the environment and continues solving the resulting subtype relation
				 * This unblocks progress when a bound variable is on either side of the subtype relation
				 * As rigid-rigid equality is covered in the basic subtyping rules, only the case where one side is a rigid bound variable needs to be handled here
				 * ***************************************************************************************/
				.with(
					[NF.Patterns.Rigid, P._],
					//([rigid, t]) => t.type !== "Var" || t.variable.type !== "Bound",
					([{ variable }, bt]) =>
						V2.Do(function* () {
							const entry = ctx.env[EB.lvl2idx(ctx, variable.lvl)];
							if (!entry) {
								throw new Error("Unbound variable in subtype");
							}
							return yield* subtype.gen(entry.nf, bt);
						}),
				)
				.with(
					[P._, NF.Patterns.Rigid],
					//([at, { variable }]) => at.type !== "Var" || at.variable.type !== "Bound",
					([at, { variable }]) =>
						V2.Do(function* () {
							const entry = ctx.env[EB.lvl2idx(ctx, variable.lvl)];
							if (!entry) {
								throw new Error("Unbound variable in subtype");
							}
							return yield* subtype.gen(at, entry.nf);
						}),
				)
				.otherwise(([a, b]) =>
					V2.Do(function* () {
						const ctx = yield* V2.ask();
						runtime.log("Subtype not implemented for", NF.display(a, ctx), "<:", NF.display(b, ctx));
						throw new Error(`Subtype not implemented for ${NF.display(a, ctx)} <: ${NF.display(b, ctx)}`);
					}),
				);

			const t = yield* V2.pure(result);
			runtime.exit();
			return t;
		});

	subtype.gen = (left: NF.Value, right: NF.Value) => V2.pure(subtype(left, right));

	return subtype;

	function contains(a: NF.Row, b: NF.Row): V2.Elaboration<Expr> {
		const onVal = (v: NF.Value, lbl: string, conj: V2.Elaboration<Expr>): V2.Elaboration<Expr> => {
			const rewritten = Row.rewrite(a, lbl, () => E.left({ tag: "Other", message: `Label ${lbl} not found` }));
			return F.pipe(
				rewritten,
				E.fold(
					() => V2.Do(() => V2.fail({ type: "MissingLabel", label: lbl, row: a })),
					rewriteResult =>
						V2.Do(function* () {
							if (rewriteResult.type !== "extension") {
								throw new Error("Row rewrite should yield extension");
							}
							const accumulated = yield* V2.pure(conj);
							const vc = yield* subtype.gen(v, rewriteResult.value);
							return Z3.And(accumulated as Bool, vc as Bool);
						}),
				),
			);
		};
		return Row.fold(b, onVal, (_rv, acc) => acc, V2.of(Z3.Bool.val(true)));
	}
};
