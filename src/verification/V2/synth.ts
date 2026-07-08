import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Row from "@yap/shared/rows";

import type { IVL } from "../solver/ivl/types";
import { Build } from "../solver/ivl/build";
import type { SynthResult } from "./types";
import type { TranslationTools } from "./logic/translate";
import type { VerificationRuntime } from "./utils/context";
import { noCapture } from "./utils/context";
import { extractModalities, selfify } from "./utils/refinements";

import * as Q from "@yap/shared/modalities/multiplicity";
import { createCheck } from "./check";
import { primopMapping } from "@yap/shared/lib/primitives";
import * as E from "fp-ts/lib/Either";
import assert from "node:assert";

type SynthDeps = {
	runtime: VerificationRuntime;
	translation: TranslationTools;
};

export const createSynth = ({ runtime, translation }: SynthDeps) => {
	const { term: translate, formula, quantify } = translation;

	const synth = (term: EB.Term): V2.Elaboration<SynthResult> =>
		V2.Do(function* () {
			const check = createCheck({ runtime, translation });
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

					return [selfified, { vc: formula(predicate, ctx) }] satisfies SynthResult;
				})
				.with({ type: "Var", variable: { type: "Free" } }, function* (tm) {
					const entry = ctx.imports[tm.variable.name];
					if (!entry) {
						throw new Error(`Unbound free variable: ${tm.variable.name}`);
					}
					const [, ty] = entry;
					const modalities = extractModalities(ty, ctx);
					const predicate = NF.reduce(modalities.liquid, NF.evaluate(ctx, tm), "Explicit");
					return [ty, { vc: formula(predicate, ctx) }] satisfies SynthResult;
				})
				.with({ type: "Var", variable: { type: "Label" } }, function* ({ variable }) {
					const type = ctx.labels[variable.name];
					if (!type) {
						throw new Error(`Unbound label variable: ${variable.name}`);
					}

					const modalities = extractModalities(type, ctx);
					const predicate = NF.reduce(modalities.liquid, NF.evaluate(ctx, term), "Explicit");
					return [type, { vc: formula(predicate, ctx) }] satisfies SynthResult;
				})
				.with({ type: "Var", variable: { type: "Foreign" } }, function* (tm) {
					const symbol = primopMapping[tm.variable.name] ?? tm.variable.name;
					const entry = ctx.imports[symbol];
					if (!entry) {
						runtime.log("synth: foreign variable not found in imports", tm.variable.name);
						return [NF.Any, { vc: Build.true_() }] satisfies SynthResult;
					}
					const [, ty] = entry;
					const modalities = extractModalities(ty, ctx);
					const predicate = NF.reduce(modalities.liquid, NF.evaluate(ctx, tm), "Explicit");
					return [ty, { vc: formula(predicate, ctx) }] satisfies SynthResult;
				})
				.with({ type: "Var" }, function* () {
					runtime.log("synth: unsupported variable kind");
					return [NF.Any, { vc: Build.true_() }] satisfies SynthResult;
				})
				.with({ type: "Lit" }, function* (tm) {
					const ann = match(tm.value)
						.with({ type: "Num" }, () => EB.Constructors.Lit({ type: "Atom", value: "Num" }))
						.with({ type: "String" }, () => EB.Constructors.Lit({ type: "Atom", value: "String" }))
						.with({ type: "Bool" }, () => EB.Constructors.Lit({ type: "Atom", value: "Bool" }))
						.with({ type: "unit" }, () => EB.Constructors.Lit({ type: "Atom", value: "Unit" }))
						.with({ type: "Atom" }, () => EB.Constructors.Lit({ type: "Atom", value: "Type" }))
						.otherwise(() => {
							throw new Error("Unsupported literal type in synthesis");
						});
					const nf = NF.evaluate(ctx, ann);
					const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
					// Empty env to avoid capturing at the refinement level — we're lifting a primitive value into a refinement predicate
					const closure = NF.Constructors.Closure(noCapture(ctx), EB.DSL.eq(bound, tm));
					const fresh = runtime.freshName();
					const modalities = {
						quantity: Q.Many,
						liquid: NF.Constructors.Lambda(fresh, "Explicit", closure, nf),
					};
					return [NF.Constructors.Modal(nf, modalities), { vc: Build.true_() }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Pi, function* () {
					return [NF.Type, { vc: Build.true_() }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Mu, function* () {
					return [NF.Type, { vc: Build.true_() }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Sigma, function* () {
					return [NF.Type, { vc: Build.true_() }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Lambda, function* (tm) {
					const annotation = NF.evaluate(ctx, tm.binding.annotation);
					const [bodyType, bodyArtefacts] = yield* V2.local(inner => EB.bind(inner, { type: "Pi", variable: tm.binding.variable }, annotation), synth(tm.body));
					const icit = tm.binding.type === "Lambda" || tm.binding.type === "Pi" ? tm.binding.icit : "Explicit";
					const bodyTypeQuoted = NF.quote(ctx, ctx.env.length + 1, bodyType);
					const type = NF.Constructors.Pi(tm.binding.variable, icit, annotation, NF.Constructors.Closure(ctx, bodyTypeQuoted));
					return [type, { vc: bodyArtefacts.vc }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Variant, function* () {
					return [NF.Type, { vc: Build.true_() }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Schema, function* () {
					return [NF.Type, { vc: Build.true_() }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Tagged, function* ({ arg }) {
					const value = EB.TaggedTerm.extract(arg.row);
					assert(value, "Tagged synthesis expected __tag atom and payload fields");

					const [payloadTy, artefacts] = yield* synth.gen(value.payload);
					const row = Row.Constructors.Extension<NF.Value, NF.Variable>(value.label, payloadTy, Row.Constructors.Empty());
					return [NF.Constructors.Variant(row), artefacts] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Struct, function* (struct) {
					const { row, vc } = yield* V2.pure(synthStructRow(struct.arg.row));
					return [NF.Constructors.Schema(row), { vc }] satisfies SynthResult;
				})
				.with(EB.CtorPatterns.Row, function* () {
					return [NF.Row, { vc: Build.true_() }] satisfies SynthResult;
				})

				.with({ type: "App" }, function* (tm) {
					const incorporate = (arg: EB.Term, fnTy: NF.Value): V2.Elaboration<SynthResult> =>
						V2.Do(function* () {
							const localCtx = yield* V2.ask();
							runtime.log("Incorporating argument type", EB.Display.Term(arg, localCtx), "into function type", NF.display(fnTy, localCtx));

							return yield* match(NF.force(localCtx, fnTy))
								.with(NF.Patterns.Modal, function* ({ value }) {
									return yield* V2.pure(incorporate(arg, value));
								})
								.with({ type: "Existential" }, function* (ex) {
									const [out, artefacts] = yield* V2.local(
										inner => EB.bind(inner, { type: "Pi", variable: ex.variable }, ex.annotation),
										incorporate(arg, ex.body.value),
									);
									return [NF.Constructors.Exists(ex.variable, ex.annotation, { ctx, value: out }), artefacts] satisfies SynthResult;
								})
								.with(NF.Patterns.Pi, function* (pi) {
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

									return [NF.Constructors.Exists(pi.binder.variable, nf ?? pi.binder.annotation, { value: out, ctx: localCtx }), { vc }] satisfies SynthResult;
								})
								.otherwise(() => {
									throw new Error("Function application expected a Pi type");
								});
						});

					const [fnTy, fnArtefacts] = yield* synth.gen(tm.func);
					const [outTy, appArtefacts] = yield* V2.pure(incorporate(tm.arg, NF.force(ctx, fnTy)));
					const combinedVc = Build.and(fnArtefacts.vc, appArtefacts.vc);
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
								return [ty, { vc: Build.and(exprArtefacts.vc, restArtefacts.vc) }] satisfies SynthResult;
							}

							if (current.type !== "Let") {
								return yield* V2.pure(recurse(rest));
							}

							return yield* V2.local(
								inner => EB.bind(inner, { type: "Let", variable: current.variable }, current.annotation),
								V2.Do(function* () {
									const artefacts = yield* check.gen(current.value, current.annotation);
									const [ty, restArtefacts] = yield* V2.pure(recurse(rest));
									const conj = Build.and(artefacts.vc, restArtefacts.vc);
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
							return yield* match(NF.force(ctx, ty))
								.with(NF.Patterns.Modal, function* (m) {
									const proj = yield* V2.pure(projected(label, m.value));
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
								.with(NF.Patterns.Sigma, function* ({ binder, closure }) {
									if (binder.annotation.type !== "Row") {
										throw new Error("Sigma binder annotation must be a Row");
									}

									const rewritten = Row.rewrite(binder.annotation.row, label);
									if (E.isLeft(rewritten)) {
										const extended = Row.Constructors.Extension(label, payloadTy, binder.annotation.row);
										const ann = NF.Constructors.Row(extended);

										const schema = match(closure.term)
											.with(EB.CtorPatterns.Schema, ({ arg }) =>
												EB.Constructors.Schema(EB.Constructors.Extension(label, NF.quote(ctx, ctx.env.length, payloadTy), arg.row)),
											)
											.otherwise(_ => {
												throw new Error("Injection expected a Schema type in sigma injection");
											});

										return NF.Constructors.Sigma(binder.variable, ann, NF.Constructors.Closure(closure.ctx, schema));
									}

									return NF.Constructors.Sigma(binder.variable, NF.Constructors.Row(rewritten.right), closure);
								})
								.otherwise(() => {
									throw new Error("Injection expected a Schema or Variant type");
								});
						});

					const outTy = yield* V2.pure(injected(inj.label, forcedBase));
					const combinedVc = Build.and(baseArtefacts.vc, valueArtefacts.vc);
					return [outTy, { vc: combinedVc }] satisfies SynthResult;
				})

				.with({ type: "Ann" }, function* (tm) {
					const ctx = yield* V2.ask();
					const ann = NF.evaluate(ctx, tm.ann);
					const artefacts = yield* check.gen(tm.term, ann);
					return [ann, artefacts] satisfies SynthResult;
				})
				.with({ type: "Reset" }, function* (tm) {
					return yield* synth.gen(tm.term);
				})
				.with({ type: "Shift" }, function* () {
					runtime.log("synth: shift expression treated as opaque (stub)");
					return [NF.Any, { vc: Build.true_() }] satisfies SynthResult;
				})
				.with({ type: "Bubble" }, function* (tm) {
					runtime.log("synth: bubble treated as opaque (neutral true)");
					return [tm.ann, { vc: Build.true_() }] satisfies SynthResult;
				})
				.otherwise(function* () {
					throw new Error("synth: case not implemented for term " + EB.Display.Term(term, ctx));
				});

			runtime.log("Synthesized type", NF.display(result[0], ctx));
			runtime.exit();
			return result;
		});

	synth.gen = (term: EB.Term) => V2.pure(synth(term));
	return synth;

	type StructRow = { row: NF.Row; vc: IVL.Formula };
	function synthStructRow(row: EB.Row): V2.Elaboration<StructRow> {
		return V2.Do(function* () {
			const result = yield* match(row)
				.with({ type: "empty" }, function* () {
					return { row: Row.Constructors.Empty(), vc: Build.true_() } satisfies StructRow;
				})
				.with({ type: "extension" }, function* ({ label, value, row: rest }) {
					const [ty, artefacts] = yield* synth.gen(value);
					// Thread this field into scope (type in labels, value in sigma) so a later field's
					// sibling `:label` reference resolves to its concrete value while the row is synthesized.
					const fieldCtx = yield* V2.ask();
					const fieldValue = NF.evaluate(fieldCtx, value);
					const restResult = yield* V2.local(
						c => EB.extendSigma(EB.extendLabel(c, label, ty), Row.Constructors.Extension(label, fieldValue, Row.Constructors.Empty())),
						synthStructRow(rest),
					);
					return {
						row: Row.Constructors.Extension(label, ty, restResult.row),
						vc: Build.and(artefacts.vc, restResult.vc),
					} satisfies StructRow;
				})
				.with({ type: "variable" }, function* ({ variable }) {
					const currentCtx = yield* V2.ask();
					return { row: Row.Constructors.Variable(toNFVariable(currentCtx, variable)), vc: Build.true_() } satisfies StructRow;
				})
				.exhaustive();
			return result;
		});
	}

	function toNFVariable(context: EB.Context, variable: EB.Variable): NF.Variable {
		return match(variable)
			.with({ type: "Bound" }, ({ index }): NF.Variable => ({ type: "Bound", lvl: context.env.length - 1 - index }))
			.with({ type: "Free" }, ({ name }): NF.Variable => ({ type: "Free", name }))
			.with({ type: "Label" }, ({ name }): NF.Variable => ({ type: "Label", name }))
			.with({ type: "Foreign" }, ({ name }): NF.Variable => ({ type: "Foreign", name }))
			.with({ type: "Meta" }, ({ val, lvl }): NF.Variable => ({ type: "Meta", val, lvl }))
			.otherwise(() => {
				throw new Error("Unsupported variable in struct row synthesis");
			});
	}
};
