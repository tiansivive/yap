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

import type { IVL } from "../solver/ivl/types";
import { Build } from "../solver/ivl/build";
import { Liquid } from "../modalities";
import { extractModalities, isFirstOrder } from "./utils/refinements";
import { noCapture } from "./utils/context";
import type { VerificationRuntime } from "./utils/context";
import type { TranslationTools } from "./logic/translate";
import type { VerificationResult } from "./types";

type SubtypeDeps = {
	runtime: VerificationRuntime;
	translation: TranslationTools;
};

export const createSubtype = ({ runtime, translation }: SubtypeDeps) => {
	const { formula, mkSort, quantify } = translation;

	const subtype = (left: NF.Value, right: NF.Value): VerificationResult<IVL.Formula> =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			runtime.enter();
			runtime.log("Subtyping:", EB.Display.Env(ctx), NF.display(left, ctx, { deBruijn: true }), "<:", NF.display(right, ctx, { deBruijn: true }));

			const result = match([NF.force(ctx, NF.unwrapNeutral(left)), NF.force(ctx, NF.unwrapNeutral(right))])
				.with([NF.Patterns.Any, P._], ([, b]) => {
					runtime.log("subtype: Any <:", NF.display(b, ctx), "— treating as trivially true (stub)");
					return V2.of(Build.true_());
				})
				.with([P._, NF.Patterns.Any], ([a]) => {
					runtime.log("subtype:", NF.display(a, ctx), "<: Any — treating as trivially true (stub)");
					return V2.of(Build.true_());
				})
				.with([NF.Patterns.Lit, NF.Patterns.Lit], ([{ value: v1 }, { value: v2 }]) => V2.of(isEqual(v1, v2) ? Build.true_() : Build.false_()))
				.with([NF.Patterns.Rigid, NF.Patterns.Rigid], ([rigid1, rigid2]) => {
					if (rigid1.variable.lvl === rigid2.variable.lvl) {
						return V2.of(Build.true_());
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
						const vcDom = yield* subtype.gen(domainA, domainB);
						const vcCod = yield* subtype.gen(codomainA, codomainB);
						return Build.and(vcDom, vcCod);
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
								return Build.and(unwrapped, vc);
							}),
						(_, acc) => acc,
						V2.of<IVL.Formula>(Build.true_()),
					);
				})
				.with([NF.Patterns.Sigma, NF.Patterns.Sigma], ([a, b]) =>
					V2.Do(function* () {
						const vc = yield* subtype.gen(a.binder.annotation, b.binder.annotation);
						const bodyA = NF.apply(a.binder, a.closure, a.binder.annotation);
						const bodyB = NF.apply(b.binder, b.closure, b.binder.annotation);
						const vcBody = yield* subtype.gen(bodyA, bodyB);
						return Build.and(vc, vcBody);
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
						return Build.and(arg, body);
					}),
				)
				.with([NF.Patterns.Recursive, NF.Patterns.Recursive], ([left, right]) =>
					V2.Do<IVL.Formula, IVL.Formula>(function* () {
						const vc1 = yield subtype(left.func, right.func);
						const vc2 = yield subtype(left.arg, right.arg);
						return Build.and(vc1, vc2);
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
							runtime.record("subtype.pi.nonrefinable", vcBody, {
								type: `${NF.display(at, envCtx)} <: ${NF.display(bt, envCtx)}`,
								description: `Function result must be subtype (non-refinable parameter ${bt.binder.variable})`,
							});
							return Build.and(vcArg, vcBody);
						}

						const sort = mkSort(bt.binder.annotation, envCtx);
						const x = Build.var_(bt.binder.variable, sort);

						const modalities = extractModalities(bt.binder.annotation, envCtx);
						if (modalities.liquid.type !== "Abs") {
							throw new Error("Liquid refinement must be a unary function");
						}
						const applied = NF.apply(modalities.liquid.binder, modalities.liquid.closure, NF.Constructors.Rigid(lvl));
						const phiX = formula(applied, envCtx, { [lvl]: x });

						const guarded = runtime.record("subtype.pi.body", Build.forall([{ name: bt.binder.variable, sort }], Build.implies(phiX, vcBody)), {
							type: `${NF.display(at, envCtx)} <: ${NF.display(bt, envCtx)}`,
							description: `Function result must be subtype under parameter ${bt.binder.variable} assumption`,
						});
						runtime.record("subtype.pi.param", vcArg, {
							type: `${NF.display(bt.binder.annotation, envCtx)} <: ${NF.display(at.binder.annotation, envCtx)}`,
							description: "Function parameter types (contravariant)",
						});
						return Build.and(vcArg, guarded);
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

				.with([{ type: "Modal" }, { type: "Modal" }], ([at, bt]) =>
					V2.Do(function* () {
						const ctx = yield* V2.ask();
						const baseVc = yield* subtype.gen(at.value, bt.value);

						const pAt = at.modalities.liquid;
						const pBt = bt.modalities.liquid;
						if (pAt.type !== "Abs" || pBt.type !== "Abs") {
							throw new Error("Liquid refinements must be unary functions");
						}

						const lvl = ctx.env.length;
						const appliedAt = NF.apply(pAt.binder, pAt.closure, NF.Constructors.Rigid(lvl));
						const appliedBt = NF.apply(pBt.binder, pBt.closure, NF.Constructors.Rigid(lvl));

						const sort = mkSort(at.value, ctx);
						const x = Build.var_(pAt.binder.variable, sort);

						const rigids = { [lvl]: x } as Record<number, IVL.Term>;
						const phiAt = formula(appliedAt, ctx, rigids);
						const phiBt = formula(appliedBt, ctx, rigids);
						const forall = Build.forall([{ name: pAt.binder.variable, sort }], Build.implies(phiAt, phiBt));
						return Build.and(baseVc, forall);
					}),
				)
				.with([{ type: "Modal" }, P._], ([at, bt]) =>
					subtype(at, NF.Constructors.Modal(bt, { quantity: Q.Zero, liquid: Liquid.Predicate.NeutralNF(bt, noCapture(ctx)) })),
				)
				.with([P._, { type: "Modal" }], ([at, bt]) =>
					subtype(NF.Constructors.Modal(at, { quantity: Q.Many, liquid: Liquid.Predicate.NeutralNF(at, noCapture(ctx)) }), bt),
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
				.with([NF.Patterns.App, NF.Patterns.App], ([left, right]) =>
					V2.Do<IVL.Formula, IVL.Formula>(function* () {
						const isFlex = (t: NF.Value) =>
							match(NF.unwrapNeutral(t))
								.with(NF.Patterns.Flex, () => true)
								.otherwise(() => false);
						if ([left.func, right.func, left.arg, right.arg].some(isFlex)) {
							const vc1 = yield subtype(left.func, right.func);
							const vc2 = yield subtype(left.arg, right.arg);
							return Build.and(vc1, vc2);
						}

						const unfoldedL = NF.unfoldMu(left);
						const unfoldedR = NF.unfoldMu(right);

						if (O.isNone(unfoldedL) && O.isNone(unfoldedR)) {
							const vc1 = yield subtype(left.func, right.func);
							const vc2 = yield subtype(left.arg, right.arg);
							return Build.and(vc1, vc2);
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

				.with([NF.Patterns.Rigid, P._], ([{ variable }, bt]) =>
					V2.Do(function* () {
						const entry = ctx.env[EB.lvl2idx(ctx, variable.lvl)];
						if (!entry) {
							throw new Error("Unbound variable in subtype");
						}
						return yield* subtype.gen(entry.nf, bt);
					}),
				)
				.with([P._, NF.Patterns.Rigid], ([at, { variable }]) =>
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

	function contains(a: NF.Row, b: NF.Row): V2.Elaboration<IVL.Formula> {
		const onVal = (v: NF.Value, lbl: string, conj: V2.Elaboration<IVL.Formula>): V2.Elaboration<IVL.Formula> => {
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
							return Build.and(accumulated, vc);
						}),
				),
			);
		};
		return Row.fold(b, onVal, (_rv, acc) => acc, V2.of(Build.true_()));
	}
};
