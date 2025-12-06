import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Row from "@yap/shared/rows";

import type { Bool, Context as Z3Context, Expr } from "z3-solver";

import type { CheckFn, SynthFn, SynthResult, SubtypeFn } from "./types";
import type { TranslationTools } from "./logic/translate";
import type { VerificationRuntime } from "./utils/context";
import { noCapture, unwrapExistential } from "./utils/context";
import { extractModalities, selfify } from "./utils/refinements";

import * as Q from "@yap/shared/modalities/multiplicity";
import { createCheck } from "./check";
import { createSubtype } from "./subtype";
import * as E from "fp-ts/lib/Either";
import assert from "node:assert";

type SynthDeps = {
	Z3: Z3Context<"main">;
	runtime: VerificationRuntime;
	translation: TranslationTools;
};

export const createSynth = ({ Z3, runtime, translation }: SynthDeps) => {
	const { translate, quantify, mkSort } = translation;

	const subtype = createSubtype({ Z3, runtime, translation });

	const synth = (term: EB.Term): V2.Elaboration<SynthResult> =>
		V2.Do(function* () {
			const check = createCheck({ Z3, runtime, translation });
			runtime.enter();
			const ctx = yield* V2.ask();
			runtime.log("Synthesizing", EB.Display.Term(term, ctx));

			const result = yield* match(term)
				.with({ type: "Var", variable: { type: "Bound" } }, function* (tm) {
					const entry = ctx.env[tm.variable.index];
					if (!entry) {
						throw new Error("Unbound bound variable in synth");
					}
					const [, , ty] = entry.type;
					const selfified = selfify(tm, ty, ctx);
					const { liquid } = extractModalities(selfified, ctx);
					assert(liquid.type === "Abs", "Liquid modality must be a Lambda");

					const predicate = NF.reduce(liquid, NF.evaluate(ctx, tm), "Explicit");

					return [selfified, { vc: translate(predicate, ctx) as Bool }] satisfies SynthResult;
				})
				.with({ type: "Var", variable: { type: "Free" } }, function* (tm) {
					const entry = ctx.imports[tm.variable.name];
					if (!entry) {
						throw new Error(`Unbound free variable: ${tm.variable.name}`);
					}
					const [, ty] = entry;
					const modalities = extractModalities(ty, ctx);
					const predicate = NF.reduce(modalities.liquid, NF.evaluate(ctx, tm), "Explicit");
					return [ty, { vc: translate(predicate, ctx) }] satisfies SynthResult;
				})
				.with({ type: "Var", variable: { type: "Label" } }, function* ({ variable }) {
					const entry = ctx.sigma[variable.name];
					if (!entry) {
						throw new Error(`Unbound label variable: ${variable.name}`);
					}

					const modalities = extractModalities(entry.ann, ctx);
					const predicate = NF.reduce(modalities.liquid, NF.evaluate(ctx, term), "Explicit");
					return [entry.ann, { vc: translate(predicate, ctx) }] satisfies SynthResult;
				})
				.with({ type: "Var" }, function* () {
					runtime.log("synth: unsupported variable kind");
					return [NF.Any, { vc: Z3.Bool.val(true) }] satisfies SynthResult;
				})
				.with({ type: "Lit" }, function* (tm) {
					const ann = match(tm.value)
						.with({ type: "Num" }, () => EB.Constructors.Lit({ type: "Atom", value: "Num" }))
						.with({ type: "String" }, () => EB.Constructors.Lit({ type: "Atom", value: "String" }))
						.with({ type: "Bool" }, () => EB.Constructors.Lit({ type: "Atom", value: "Bool" }))
						.with({ type: "unit" }, () => EB.Constructors.Lit({ type: "Atom", value: "Unit" }))
						.with(
							{ type: "Atom" },
							({ value }) => ["Num", "String", "Bool", "Unit", "Type", "Row"].includes(value),
							() => EB.Constructors.Lit({ type: "Atom", value: "Type" }),
						)
						.otherwise(() => {
							throw new Error("Unsupported literal type in synthesis");
						});
					const nf = NF.evaluate(ctx, ann);
					const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
					//NOTE:IMPORTANT: empty env to avoid capturing at the refinement level. We're lifitng the primitive vlaue to the refinement, so we need to be careful
					const closure = NF.Constructors.Closure(noCapture(ctx), EB.DSL.eq(bound, tm));
					const fresh = runtime.freshName();
					const modalities = {
						quantity: Q.Many,
						liquid: NF.Constructors.Lambda(fresh, "Explicit", closure, nf),
					};
					return [NF.Constructors.Modal(nf, modalities), { vc: Z3.Bool.val(true) }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Pi, function* () {
					return [NF.Type, { vc: Z3.Bool.val(true) }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Mu, function* () {
					return [NF.Type, { vc: Z3.Bool.val(true) }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Sigma, function* () {
					return [NF.Type, { vc: Z3.Bool.val(true) }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Lambda, function* (tm) {
					const annotation = NF.evaluate(ctx, tm.binding.annotation);
					const [_, bodyArtefacts] = yield* V2.local(inner => EB.bind(inner, { type: "Pi", variable: tm.binding.variable }, annotation), synth(tm.body));
					const icit = tm.binding.type === "Lambda" || tm.binding.type === "Pi" ? tm.binding.icit : "Explicit";
					const type = NF.Constructors.Pi(tm.binding.variable, icit, annotation, NF.Constructors.Closure(ctx, tm.body));
					return [type, { vc: bodyArtefacts.vc }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Variant, function* () {
					return [NF.Type, { vc: Z3.Bool.val(true) }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Schema, function* () {
					return [NF.Type, { vc: Z3.Bool.val(true) }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Struct, function* (struct) {
					const { row, vc } = yield* V2.pure(synthStructRow(struct.arg.row));
					return [NF.Constructors.Schema(row), { vc }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Row, function* () {
					return [NF.Row, { vc: Z3.Bool.val(true) }] satisfies SynthResult;
				})

				.with({ type: "App" }, function* (tm) {
					const incorporate = (arg: EB.Term, fnTy: NF.Value): V2.Elaboration<SynthResult> =>
						V2.Do(function* () {
							const localCtx = yield* V2.ask();
							runtime.log("Incorporating argument type", EB.Display.Term(arg, localCtx), "into function type", NF.display(fnTy, localCtx));

							return yield* match(fnTy)
								.with({ type: "Existential" }, function* (ex) {
									const [out, artefacts] = yield* V2.local(
										inner => EB.bind(inner, { type: "Pi", variable: ex.variable }, ex.annotation),
										incorporate(arg, ex.body.value),
									);
									return [NF.Constructors.Exists(ex.variable, ex.annotation, { ctx, value: out }), artefacts] satisfies SynthResult;
								})
								.with(NF.Patterns.Pi, function* (pi) {
									// Ignore the local incorporation context = that's only for the existentials.
									// We need to check the argument in the original context so that bound variables are correctly resolved.
									// FIXME: Pass an explicit ctx as an argument to incorporate instead of relying on V2.ask().
									// That way checking will always happen in the right context and we can be explicit about which context to capture in existentials.
									const { vc, nf } = yield* V2.local(_ => ctx, check(arg, pi.binder.annotation));

									const evaluatedArg = NF.evaluate(ctx, arg);
									const appliedArg = match(evaluatedArg)
										.with(
											{ type: "Neutral" },
											neutral => neutral.value.type !== "Var",
											() => NF.Constructors.Rigid(localCtx.env.length),
										)
										.otherwise(() => evaluatedArg);
									const out = NF.apply(pi.binder, pi.closure, appliedArg);

									// NOTE: This is a modification of Syn-App-Ex
									// The Syn-App-Ex rule (Jhala & Vazou, from Knowles & Flanagan) prescribes synthesizing both function and argument, then using subtyping to verify compatibility.
									// However, this only works when ALL terms are intrinsic (self-typing) and some terms are extrinsic - they require bidirectional checking.

									// Example: `match b | true -> Num | false -> String` cannot be synthesized without surrounding context. Is the codomain `Num | String` or `Type` or something else entirely?
									// During elaboration, unification constraints provide the needed context and resolve this.
									// Since verification happens after elaboration, the `match` term has already been typechecked and we merely need to reconstruct the inferred types
									// However, the term itself lacks the information needed for synthesis.
									//
									// The solution is to use `check` instead of `synth` for arguments. Checking allows us to leverage the surrounding context established during elaboration and properly handle extrinsic terms.
									// When `check` necessarily synthesizes a potential more precise type (e.g., with selfification refinements), it returns it via the optional `nf` field.
									// Using it here propagates the subtype information through applications. Otherwise, we fall back to the Pi binder's annotation.
									//
									// TODO:Future: Cache elaborated types in the AST to enable pure synthesis during verification.
									return [NF.Constructors.Exists(pi.binder.variable, nf ?? pi.binder.annotation, { value: out, ctx: localCtx }), { vc }] satisfies SynthResult;
								})
								.otherwise(() => {
									throw new Error("Function application expected a Pi type");
								});
						});

					const [fnTy, fnArtefacts] = yield* synth.gen(tm.func);
					// const unwrapped = unwrapExistential(fnTy)
					// assert(unwrapped.type === "Abs" && unwrapped.binder.type === "Pi", "Function position must be a Pi type after unwrapping existentials");
					// const checked = yield* check.gen(tm.arg, unwrapped.binder.annotation);

					// const [argTy, argArtefacts] = yield* synth.gen(tm.arg);
					const [outTy, appArtefacts] = yield* V2.pure(incorporate(tm.arg, NF.force(ctx, fnTy)));
					// const combinedVc = Z3.And(Z3.And(fnArtefacts.vc as Bool, checked.vc as Bool), appArtefacts.vc as Bool);
					const combinedVc = Z3.And(fnArtefacts.vc as Bool, appArtefacts.vc as Bool);
					return [outTy, { vc: combinedVc }] satisfies SynthResult;
				})
				.with({ type: "Block" }, function* (block) {
					const recurse = (statements: EB.Statement[]): V2.Elaboration<SynthResult> =>
						V2.Do(function* () {
							if (statements.length === 0) {
								return yield* synth.gen(block.return);
							}

							const [current, ...rest] = statements;
							if (current.type === "Expression") {
								const [, exprArtefacts] = yield* synth.gen(current.value);
								const [ty, restArtefacts] = yield* V2.pure(recurse(rest));
								return [ty, { vc: Z3.And(exprArtefacts.vc as Bool, restArtefacts.vc as Bool) }] satisfies SynthResult;
							}

							if (current.type !== "Let") {
								return yield* V2.pure(recurse(rest));
							}

							return yield* V2.local(
								inner => EB.bind(inner, { type: "Let", variable: current.variable }, current.annotation),
								V2.Do(function* () {
									const artefacts = yield* check.gen(current.value, current.annotation);
									const [ty, restArtefacts] = yield* V2.pure(recurse(rest));
									const conj = Z3.And(artefacts.vc as Bool, restArtefacts.vc as Bool);
									const ctx = yield* V2.ask();
									const quantified = quantify(current.variable, current.annotation, conj, ctx);
									const existential = NF.Constructors.Exists(current.variable, current.annotation, { ctx, value: ty });
									return [existential, { vc: quantified }] satisfies SynthResult;
								}),
							);
						});

					return yield* V2.pure(recurse(block.statements));
				})
				.with(EB.CtorPatterns.Proj, function* (proj) {
					const [baseTy, baseArtefacts] = yield* synth.gen(proj.term);
					const projected = (label: string, ty: NF.Value): V2.Elaboration<NF.Value> =>
						V2.Do(function* () {
							return yield* match(ty)
								.with(NF.Patterns.Modal, function* (m) {
									const proj = yield* V2.pure(projected(label, m.value));
									// TODO: We probably need to find some way to preserve the modalities on the base tye here.
									// This assuming we want to allow refinements on row types
									// Maybe implication or conjunction? Anther possibiliy is returning an existential, much like in application
									// return NF.Constructors.Modal(proj, m.modalities);
									return proj;
								})
								.with(NF.Patterns.Schema, function* ({ func, arg }) {
									const rewritten = Row.rewrite(arg.row, label);
									if (E.isLeft(rewritten)) {
										throw new Error("Projection label not found: " + label);
									}
									if (rewritten.right.type !== "extension") {
										throw new Error("Projected label is not an extension: " + label);
									}

									return rewritten.right.value;
								})
								.with(NF.Patterns.Sigma, function* ({ binder, closure }) {
									if (binder.annotation.type !== "Row") {
										throw new Error("Sigma binder annotation must be a Row");
									}

									const rewritten = Row.rewrite(binder.annotation.row, label);
									if (E.isLeft(rewritten)) {
										throw new Error("Projection label not found in Sigma: " + label);
									}
									if (rewritten.right.type !== "extension") {
										throw new Error("Projected label is not an extension in Sigma: " + label);
									}
									return rewritten.right.value;
								})
								.otherwise(() => {
									throw new Error("Projection expected a Sigma type");
								});
						});

					const outTy = yield* V2.pure(projected(proj.label, baseTy));
					return [outTy, { vc: baseArtefacts.vc }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Inj, function* (inj) {
					const [baseTy, baseArtefacts] = yield* synth.gen(inj.term);
					const forcedBase = NF.force(ctx, baseTy);
					const [valueTy, valueArtefacts] = yield* synth.gen(inj.value);
					const payloadTy = NF.force(ctx, valueTy);

					const injected = (label: string, ty: NF.Value): V2.Elaboration<NF.Value> =>
						V2.Do(function* () {
							return yield* match(ty)
								.with(NF.Patterns.Modal, function* ({ value, modalities }) {
									const inner = yield* V2.pure(injected(label, value));
									return NF.Constructors.Modal(inner, modalities);
								})
								.with(NF.Patterns.Schema, function* ({ func, arg }) {
									const rewritten = Row.rewrite(arg.row, label);
									if (E.isLeft(rewritten)) {
										const extended = Row.Constructors.Extension(label, payloadTy, arg.row);
										return NF.Constructors.App(func, NF.Constructors.Row(extended), "Explicit");
									}

									return NF.Constructors.App(func, NF.Constructors.Row(rewritten.right), "Explicit");
								})
								.otherwise(() => {
									throw new Error("Injection expected a Schema or Variant type");
								});
						});

					const outTy = yield* V2.pure(injected(inj.label, forcedBase));
					const combinedVc = Z3.And(baseArtefacts.vc as Bool, valueArtefacts.vc as Bool);
					return [outTy, { vc: combinedVc }] satisfies SynthResult;
				})

				.otherwise(function* () {
					//  runtime.log("synth: case not implemented");
					throw new Error("synth: case not implemented for term " + EB.Display.Term(term, ctx));
				});

			runtime.log("Synthesized type", NF.display(result[0], ctx));
			runtime.exit();
			return result;
		});

	synth.gen = (term: EB.Term) => V2.pure(synth(term));
	return synth;

	type StructRow = { row: NF.Row; vc: Expr };
	function synthStructRow(row: EB.Row): V2.Elaboration<StructRow> {
		return V2.Do(function* () {
			const result = yield* match(row)
				.with({ type: "empty" }, function* () {
					return { row: Row.Constructors.Empty(), vc: Z3.Bool.val(true) } satisfies StructRow;
				})
				.with({ type: "extension" }, function* ({ label, value, row: rest }) {
					const [ty, artefacts] = yield* synth.gen(value);
					const restResult = yield* V2.pure(synthStructRow(rest));
					return {
						row: Row.Constructors.Extension(label, ty, restResult.row),
						vc: Z3.And(artefacts.vc as Bool, restResult.vc as Bool),
					} satisfies StructRow;
				})
				.with({ type: "variable" }, function* ({ variable }) {
					const currentCtx = yield* V2.ask();
					return { row: Row.Constructors.Variable(toNFVariable(currentCtx, variable)), vc: Z3.Bool.val(true) } satisfies StructRow;
				})
				.exhaustive();
			return result;
		});
	}

	function toNFVariable(context: EB.Context, variable: EB.Variable): NF.Variable {
		return match(variable)
			.with({ type: "Bound" }, ({ index }) => ({ type: "Bound", lvl: context.env.length - 1 - index }) as NF.Variable)
			.with({ type: "Free" }, ({ name }) => ({ type: "Free", name }) as NF.Variable)
			.with({ type: "Label" }, ({ name }) => ({ type: "Label", name }) as NF.Variable)
			.with({ type: "Foreign" }, ({ name }) => ({ type: "Foreign", name }) as NF.Variable)
			.with({ type: "Meta" }, ({ val, lvl }) => ({ type: "Meta", val, lvl }) as NF.Variable)
			.otherwise(() => {
				throw new Error("Unsupported variable in struct row synthesis");
			});
	}
};
