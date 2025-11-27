import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Row from "@yap/shared/rows";

import type { Bool, Context as Z3Context, Expr } from "z3-solver";

import type { CheckFn, SynthFn, SynthResult, SubtypeFn } from "./types";
import type { TranslationTools } from "./logic/translate";
import type { VerificationRuntime } from "./utils/context";
import { noCapture } from "./utils/context";
import { extractModalities, selfify } from "./utils/refinements";

import * as Q from "@yap/shared/modalities/multiplicity";
import { createCheck } from "./check";
import { createSubtype } from "./subtype";

type SynthDeps = {
	Z3: Z3Context<"main">;
	runtime: VerificationRuntime;
	translation: TranslationTools;
};

export const createSynth = ({ Z3, runtime, translation }: SynthDeps) => {
	const { translate, quantify } = translation;

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
					const modalities = extractModalities(selfified, ctx);
					const predicate = NF.reduce(modalities.liquid, NF.evaluate(ctx, tm), "Explicit");
					return [selfified, { vc: translate(predicate, ctx) }] satisfies SynthResult;
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
				.with({ type: "Var" }, function* () {
					runtime.log("synth: unsupported variable kind");
					return [NF.Any, { vc: Z3.Bool.val(true) }] satisfies SynthResult;
				})
				.with({ type: "Lit" }, function* (tm) {
					const ann = match(tm.value)
						.with({ type: "Atom" }, lit => EB.Constructors.Lit(lit))
						.with({ type: "Num" }, () => EB.Constructors.Lit({ type: "Atom", value: "Num" }))
						.with({ type: "String" }, () => EB.Constructors.Lit({ type: "Atom", value: "String" }))
						.with({ type: "Bool" }, () => EB.Constructors.Lit({ type: "Atom", value: "Bool" }))
						.with({ type: "unit" }, () => EB.Constructors.Lit({ type: "Atom", value: "Unit" }))
						.exhaustive();
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
				.with({ type: "App" }, function* (tm) {
					const incorporate = (argTy: NF.Value, fnTy: NF.Value): V2.Elaboration<SynthResult> =>
						V2.Do(function* () {
							const localCtx = yield* V2.ask();
							runtime.log("Incorporating argument type", NF.display(argTy, localCtx), "into function type", NF.display(fnTy, localCtx));

							return yield* match(fnTy)
								.with({ type: "Existential" }, function* (ex) {
									const [out, artefacts] = yield* V2.local(
										inner => EB.bind(inner, { type: "Pi", variable: ex.variable }, ex.annotation),
										incorporate(argTy, ex.body.value),
									);
									return [NF.Constructors.Exists(ex.variable, ex.annotation, { ctx, value: out }), artefacts] satisfies SynthResult;
								})
								.with(NF.Patterns.Pi, function* (pi) {
									const vc = yield* subtype.gen(argTy, pi.binder.annotation);
									const evaluatedArg = NF.evaluate(localCtx, tm.arg);
									const appliedArg = evaluatedArg.type !== "Neutral" ? evaluatedArg : NF.Constructors.Rigid(localCtx.env.length);
									const out = NF.apply(pi.binder, pi.closure, appliedArg);
									return [NF.Constructors.Exists(pi.binder.variable, argTy, { value: out, ctx: localCtx }), { vc }] satisfies SynthResult;
								})
								.otherwise(() => {
									throw new Error("Function application expected a Pi type");
								});
						});

					const [fnTy, fnArtefacts] = yield* synth.gen(tm.func);
					const [argTy, argArtefacts] = yield* synth.gen(tm.arg);
					const [outTy, appArtefacts] = yield* V2.pure(incorporate(NF.force(ctx, argTy), NF.force(ctx, fnTy)));
					const combinedVc = Z3.And(Z3.And(fnArtefacts.vc as Bool, argArtefacts.vc as Bool), appArtefacts.vc as Bool);
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
									const quantified = quantify(current.variable, current.annotation, conj, ctx);
									return [ty, { vc: quantified }] satisfies SynthResult;
								}),
							);
						});

					return yield* V2.pure(recurse(block.statements));
				})
				.otherwise(function* () {
					runtime.log("synth: case not implemented");
					return [NF.Any, { vc: Z3.Bool.val(true) }] satisfies SynthResult;
				});

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
