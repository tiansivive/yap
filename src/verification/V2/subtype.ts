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
import { extractModalities, type ExtractModalitiesFn } from "./utils/refinements";
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
	const { translate, mkSort, quantify } = translation;

	const subtype = (left: NF.Value, right: NF.Value): VerificationResult<Expr> =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			runtime.enter();
			runtime.log("Subtyping:", EB.Display.Env(ctx), NF.display(left, ctx, { deBruijn: true }), "<:", NF.display(right, ctx, { deBruijn: true }));

			const result = match([NF.unwrapNeutral(left), NF.unwrapNeutral(right)])
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
				.with(
					[NF.Patterns.Rigid, NF.Patterns.Rigid],
					([rigid1, rigid2]) => rigid1.variable.lvl === rigid2.variable.lvl,
					() => {
						return V2.of(Z3.Bool.val(true));
					},
				)
				.with(
					[NF.Patterns.Rigid, P._],
					([rigid, t]) => t.type !== "Var" || t.variable.type !== "Bound",
					([{ variable }, bt]) =>
						V2.Do(function* () {
							const entry = ctx.env[variable.lvl];
							if (!entry) {
								throw new Error("Unbound variable in subtype");
							}
							return yield* subtype.gen(entry.nf, bt);
						}),
				)
				.with(
					[P._, NF.Patterns.Rigid],
					([at, { variable }]) => at.type !== "Var" || at.variable.type !== "Bound",
					([at, { variable }]) =>
						V2.Do(function* () {
							const entry = ctx.env[variable.lvl];
							if (!entry) {
								throw new Error("Unbound variable in subtype");
							}
							return yield* subtype.gen(at, entry.nf);
						}),
				)
				.with([NF.Patterns.Mu, NF.Patterns.Mu], ([mu1, mu2]) =>
					V2.Do(function* () {
						const arg = yield* subtype.gen(mu1.binder.annotation, mu2.binder.annotation);
						const body1 = NF.apply(mu1.binder, mu1.closure, NF.Constructors.Rigid(ctx.env.length));
						const body2 = NF.apply(mu2.binder, mu2.closure, NF.Constructors.Rigid(ctx.env.length));
						const body = yield* subtype.gen(body1, body2);
						return Z3.And(arg as Bool, body as Bool);
					}),
				)
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
				.with([NF.Patterns.Schema, NF.Patterns.Sigma], ([schema, sig]) => {
					const body = NF.apply(sig.binder, sig.closure, NF.Constructors.Row(schema.arg.row));
					return subtype(schema, body);
				})
				.with([NF.Patterns.Sigma, NF.Patterns.Schema], ([sig, schema]) => {
					const body = NF.apply(sig.binder, sig.closure, NF.Constructors.Row(schema.arg.row));
					return subtype(body, schema);
				})
				.with([NF.Patterns.Schema, NF.Patterns.Schema], ([{ arg: a }, { arg: b }]) => contains(a.row, b.row))
				.with([NF.Patterns.Variant, NF.Patterns.Variant], ([{ arg: a }, { arg: b }]) => contains(b.row, a.row))
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
				.with(
					[
						{ type: "Abs", binder: { type: "Pi" } },
						{ type: "Abs", binder: { type: "Pi" } },
					],
					([at, bt]) =>
						V2.Do(function* () {
							const vcArg = yield* subtype.gen(bt.binder.annotation, at.binder.annotation);
							const envCtx = yield* V2.ask();
							const lvl = envCtx.env.length;
							const anf = NF.apply(at.binder, at.closure, NF.Constructors.Rigid(lvl));
							const bnf = NF.apply(bt.binder, bt.closure, NF.Constructors.Rigid(lvl));
							const vcBody = yield* V2.local(ctx => EB.bind(ctx, bt.binder, bt.binder.annotation), subtype(anf, bnf));

							const sortMap = mkSort(bt.binder.annotation, envCtx);
							const xSort = match(sortMap)
								.with({ Prim: P.select() }, p => p)
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
				.with([NF.Patterns.Lit, NF.Patterns.Lit], ([{ value: v1 }, { value: v2 }]) => V2.of(Z3.Bool.val(isEqual(v1, v2))))
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
