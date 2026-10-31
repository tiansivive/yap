import { match, P } from "ts-pattern";
import assert from "node:assert";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Row from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import { primopMapping } from "@yap/shared/lib/primitives";

import type { IVL } from "../solver/ivl/types";
import { Build } from "../solver/ivl/build";
import type { SynthResult } from "./types";
import { reader, logger, supply, type Verification } from "./effects";
import { noCapture } from "./utils/context";
import { extractModalities, selfify } from "./utils/refinements";
import { check } from "./check";
import { formula, quantify } from "./logic/translate";

export const synth = function* (term: EB.Term): Verification<SynthResult> {
	yield* logger.enter();
	const ctx = yield* reader.ask();
	const registry = yield* Metas.registry.get();
	const run = NF.probe(ctx, registry);
	yield* logger.log(
		"Synthesizing",
		run(() => EB.Display.Term(term)),
	);

	const result = yield* match(term)
		.with({ type: "Var", variable: { type: "Bound" } }, function* (tm) {
			const entry = ctx.env[tm.variable.index];
			if (!entry) {
				throw new Error("Unbound bound variable in synth");
			}
			const [, , ty] = entry.type;
			const selfified = yield* selfify(tm, ty);
			const { liquid } = yield* extractModalities(selfified, ctx);
			assert(liquid.type === "Abs", "Liquid modality must be a Lambda");

			const evaluated = yield* NF.evaluate(tm);
			const predicate = yield* NF.reduce(liquid, evaluated, "Explicit");

			return [selfified, { vc: yield* formula(predicate) }] satisfies SynthResult;
		})
		.with({ type: "Var", variable: { type: "Free" } }, function* (tm) {
			const entry = ctx.imports[tm.variable.name];
			if (!entry) {
				throw new Error(`Unbound free variable: ${tm.variable.name}`);
			}
			const [, ty] = entry;
			const modalities = yield* extractModalities(ty, ctx);
			const evaluated = yield* NF.evaluate(tm);
			const predicate = yield* NF.reduce(modalities.liquid, evaluated, "Explicit");
			return [ty, { vc: yield* formula(predicate) }] satisfies SynthResult;
		})
		.with({ type: "Var", variable: { type: "Label" } }, function* ({ variable }) {
			const type = ctx.labels[variable.name];
			if (!type) {
				throw new Error(`Unbound label variable: ${variable.name}`);
			}

			const modalities = yield* extractModalities(type, ctx);
			const evaluated = yield* NF.evaluate(term);
			const predicate = yield* NF.reduce(modalities.liquid, evaluated, "Explicit");
			return [type, { vc: yield* formula(predicate) }] satisfies SynthResult;
		})
		.with(EB.CtorPatterns.Vars.DepLabel, EB.CtorPatterns.Vars.NuLabel, function* ({ variable }) {
			return [variable.annotation, { vc: Build.true_() }] satisfies SynthResult;
		})
		.with({ type: "Var", variable: { type: "Foreign" } }, function* (tm) {
			const symbol = primopMapping[tm.variable.name] ?? tm.variable.name;
			const entry = ctx.imports[symbol];
			if (!entry) {
				yield* logger.log("synth: foreign variable not found in imports", tm.variable.name);
				return [NF.Any, { vc: Build.true_() }] satisfies SynthResult;
			}
			const [, ty] = entry;
			const modalities = yield* extractModalities(ty, ctx);
			const evaluated = yield* NF.evaluate(tm);
			const predicate = yield* NF.reduce(modalities.liquid, evaluated, "Explicit");
			return [ty, { vc: yield* formula(predicate) }] satisfies SynthResult;
		})
		.with({ type: "Var" }, function* () {
			yield* logger.log("synth: unsupported variable kind");
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
			const nf = yield* NF.evaluate(ann);
			const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
			const closure = NF.Constructors.Closure(noCapture(ctx), EB.DSL.eq(bound, tm));
			const freshName = yield* supply.fresh();
			const modalities = {
				quantity: Q.Many,
				liquid: NF.Constructors.Lambda(freshName, "Explicit", closure, nf),
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
		.with(EB.CtorPatterns.SigmaV2, function* () {
			return [NF.Type, { vc: Build.true_() }] satisfies SynthResult;
		})
		.with(EB.CtorPatterns.Nu, function* (tm) {
			// TODO: lazy records, once some syntax can build one
			assert(tm.binding.mode === "strict", "Verification supports strict records only");
			return yield* reader.local(c => EB.open(tm.binding, c), synth(tm.body));
		})
		.with(EB.CtorPatterns.Lambda, function* (tm) {
			const annotation = yield* NF.evaluate(tm.binding.annotation);
			const [bodyType, bodyArtefacts] = yield* reader.local(inner => EB.bind(inner, { type: "Pi", variable: tm.binding.variable }, annotation), synth(tm.body));
			const icit = tm.binding.type === "Lambda" || tm.binding.type === "Pi" ? tm.binding.icit : "Explicit";
			const bodyTypeQuoted = yield* NF.quote(ctx.env.length + 1, bodyType);
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

			const [payloadTy, artefacts] = yield* synth(value.payload);
			const row = Row.Constructors.Extension<NF.Value, NF.Variable>(value.label, payloadTy, Row.Constructors.Empty());
			return [NF.Constructors.Variant(row), artefacts] satisfies SynthResult;
		})
		.with(EB.CtorPatterns.Struct, function* (struct) {
			const { row, vc } = yield* synthStructRow(struct.arg.row);
			return [NF.Constructors.Schema(row), { vc }] satisfies SynthResult;
		})
		.with(EB.CtorPatterns.Row, function* () {
			return [NF.Row, { vc: Build.true_() }] satisfies SynthResult;
		})

		.with({ type: "App" }, function* (tm) {
			const incorporate = function* (arg: EB.Term, fnTy: NF.Value): Verification<SynthResult> {
				const localCtx = yield* reader.ask();
				const localRegistry = yield* Metas.registry.get();
				const localRun = NF.probe(localCtx, localRegistry);
				const viewed = yield* NF.view(fnTy);
				yield* logger.log(
					"Incorporating argument type",
					localRun(() => EB.Display.Term(arg)),
					"into function type",
					localRun(() => NF.display(fnTy)),
				);

				return yield* match<NF.View, Verification<SynthResult>>(viewed)
					.with(NF.View.Sealed(NF.Patterns.Modal), function* ({ value }) {
						return yield* incorporate(arg, value.value);
					})
					.with(NF.View.Sealed({ type: "Existential" }), function* ({ value: ex }) {
						const [out, artefacts] = yield* reader.local(
							inner => EB.bind(inner, { type: "Pi", variable: ex.variable }, ex.annotation),
							incorporate(arg, ex.body.value),
						);
						return [NF.Constructors.Exists(ex.variable, ex.annotation, { ctx, value: out }), artefacts] satisfies SynthResult;
					})
					.with(NF.View.Sealed(NF.Patterns.Pi), function* ({ value: pi }) {
						const { vc, nf } = yield* reader.local(_ => ctx, check(arg, pi.binder.annotation));

						const evaluatedArg = yield* reader.local(_ => ctx, NF.evaluate(arg));
						// TODO: investigate observing through `view`. This tests for an opaque argument, which needs a sealed neutral
						// told apart from a plain value; `view` classifies both as Sealed.
						const appliedArg = match(NF.unglue(evaluatedArg))
							.with(
								{ type: "Neutral" },
								neutral => neutral.value.type !== "Var",
								() => NF.Constructors.Rigid(localCtx.env.length),
							)
							.otherwise(() => evaluatedArg);
						const out = yield* NF.apply(pi.binder, pi.closure, appliedArg);

						return [NF.Constructors.Exists(pi.binder.variable, nf ?? pi.binder.annotation, { value: out, ctx: localCtx }), { vc }] satisfies SynthResult;
					})
					.otherwise(function* () {
						throw new Error("Function application expected a Pi type");
					});
			};

			const [fnTy, fnArtefacts] = yield* synth(tm.func);
			const forced = yield* NF.force(fnTy);
			const [outTy, appArtefacts] = yield* incorporate(tm.arg, forced);
			const combinedVc = Build.and(fnArtefacts.vc, appArtefacts.vc);
			return [outTy, { vc: combinedVc }] satisfies SynthResult;
		})
		.with({ type: "Block" }, function* (block) {
			const recurse = function* (statements: EB.Statement[]): Verification<SynthResult> {
				if (statements.length === 0) {
					return yield* synth(block.return);
				}

				const [current, ...rest] = statements;
				if (current.type === "Expression") {
					const [, exprArtefacts] = yield* synth(current.value);
					const [ty, restArtefacts] = yield* recurse(rest);
					return [ty, { vc: Build.and(exprArtefacts.vc, restArtefacts.vc) }] satisfies SynthResult;
				}

				if (current.type !== "Let") {
					return yield* recurse(rest);
				}

				return yield* reader.local(
					inner => EB.bind(inner, { type: "Let", variable: current.variable }, current.annotation),
					(function* (): Verification<SynthResult> {
						const artefacts = yield* check(current.value, current.annotation);
						const [ty, restArtefacts] = yield* recurse(rest);
						const conj = Build.and(artefacts.vc, restArtefacts.vc);
						const quantified = yield* quantify(current.variable, current.annotation, conj);
						const letCtx = yield* reader.ask();
						const existential = NF.Constructors.Exists(current.variable, current.annotation, { ctx: letCtx, value: ty });
						return [existential, { vc: quantified }] satisfies SynthResult;
					})(),
				);
			};

			return yield* recurse(block.statements);
		})
		.with(EB.CtorPatterns.Proj, function* (proj) {
			const [baseTy, baseArtefacts] = yield* synth(proj.term);
			const projected = function* (label: string, ty: NF.Value): Verification<NF.Value> {
				const viewed = yield* NF.view(ty);
				return yield* match(viewed)
					.with(NF.View.Sealed(), function* ({ value }) {
						return yield* match(value)
							.with(NF.Patterns.Modal, function* (modal) {
								return yield* projected(label, modal.value);
							})
							.with(NF.Patterns.Schema, function* ({ arg }) {
								const field = Row.lookup(arg.row, label);
								if (!field) {
									throw new Error("Projection label not found: " + label);
								}

								return field;
							})
							.with(NF.Patterns.Sigma, function* ({ binder }) {
								if (binder.annotation.type !== "Row") {
									throw new Error("Sigma binder annotation must be a Row");
								}

								const field = Row.lookup(binder.annotation.row, label);
								if (!field) {
									throw new Error("Projection label not found in Sigma: " + label);
								}
								return field;
							})
							.with(NF.Patterns.SigmaV2, function* ({ binder, closure }) {
								const witness = yield* NF.evaluate(proj.term);
								const schema = yield* NF.apply(binder, closure, witness);
								const row = yield* NF.rowOf(schema);

								return yield* match(row)
									.with(P.nonNullable, function* (row) {
										const field = Row.lookup(row, label);
										if (!field) {
											throw new Error("Projection label not found in SigmaV2: " + label);
										}
										return field;
									})
									.otherwise(function* () {
										throw new Error("SigmaV2 projection expected a Schema body");
									});
							})
							.otherwise(() => {
								throw new Error("Projection expected a Sigma type");
							});
					})
					.otherwise(() => {
						throw new Error("Projection expected a Sigma type");
					});
			};

			const outTy = yield* projected(proj.label, baseTy);
			return [outTy, { vc: baseArtefacts.vc }] satisfies SynthResult;
		})
		.with(EB.CtorPatterns.Inj, function* (inj) {
			const [baseTy, baseArtefacts] = yield* synth(inj.term);
			const [valueTy, valueArtefacts] = yield* synth(inj.value);
			const payloadTy = yield* NF.force(valueTy);

			const injected = function* (label: string, ty: NF.Value): Verification<NF.Value> {
				const viewed = yield* NF.view(ty);
				return yield* match(viewed)
					.with(NF.View.Sealed(), function* ({ value }) {
						return yield* match(value)
							.with(NF.Patterns.Modal, function* ({ value, modalities }) {
								const inner = yield* injected(label, value);
								return NF.Constructors.Modal(inner, modalities);
							})
							.with(NF.Patterns.Schema, function* ({ func, arg }) {
								if (Row.lookup(arg.row, label) === undefined) {
									const extended = Row.Constructors.Extension(label, payloadTy, arg.row);
									return NF.Constructors.App(func, NF.Constructors.Row(extended), "Explicit");
								}

								return value;
							})
							.with(NF.Patterns.Sigma, function* ({ binder, closure }) {
								if (binder.annotation.type !== "Row") {
									throw new Error("Sigma binder annotation must be a Row");
								}

								if (Row.lookup(binder.annotation.row, label) === undefined) {
									const extended = Row.Constructors.Extension(label, payloadTy, binder.annotation.row);
									const ann = NF.Constructors.Row(extended);
									const quotedPayload = yield* NF.quote(ctx.env.length, payloadTy);

									const schema = match(closure.term)
										.with(EB.CtorPatterns.Schema, ({ arg }) => EB.Constructors.Schema(EB.Constructors.Extension(label, quotedPayload, arg.row)))
										.otherwise(_ => {
											throw new Error("Injection expected a Schema type in sigma injection");
										});

									return NF.Constructors.Sigma(binder.variable, ann, NF.Constructors.Closure(closure.ctx, schema));
								}

								return value;
							})
							.with(NF.Patterns.SigmaV2, function* ({ binder, closure }) {
								if (binder.annotation.type !== "Row") {
									throw new Error("SigmaV2 binder annotation must be a Row");
								}

								const slots = binder.annotation.row;
								if (Row.lookup(slots, label) !== undefined) {
									return value;
								}

								const ann = NF.Constructors.Row(Row.Constructors.Extension(label, NF.Irrelevant, slots));
								const quotedPayload = yield* NF.quote(ctx.env.length, payloadTy);

								const schema = match(closure.term)
									.with(EB.CtorPatterns.Schema, ({ arg }) => EB.Constructors.Schema(EB.Constructors.Extension(label, quotedPayload, arg.row)))
									.otherwise(_ => {
										throw new Error("Injection expected a Schema type in SigmaV2 injection");
									});

								return NF.Constructors.SigmaV2(binder.variable, ann, NF.Constructors.Closure(closure.ctx, schema));
							})
							.otherwise(() => {
								throw new Error("Injection expected a Schema or Variant type");
							});
					})
					.otherwise(() => {
						throw new Error("Injection expected a Schema or Variant type");
					});
			};

			const outTy = yield* injected(inj.label, baseTy);
			const combinedVc = Build.and(baseArtefacts.vc, valueArtefacts.vc);
			return [outTy, { vc: combinedVc }] satisfies SynthResult;
		})

		.with({ type: "Ann" }, function* (tm) {
			const ann = yield* NF.evaluate(tm.ann);
			const artefacts = yield* check(tm.term, ann);
			return [ann, artefacts] satisfies SynthResult;
		})
		.with({ type: "Reset" }, function* (tm) {
			return yield* synth(tm.term);
		})
		.with({ type: "Shift" }, function* () {
			yield* logger.log("synth: shift expression treated as opaque (stub)");
			return [NF.Any, { vc: Build.true_() }] satisfies SynthResult;
		})
		.with({ type: "Bubble" }, function* (tm) {
			yield* logger.log("synth: bubble treated as opaque (neutral true)");
			return [tm.ann, { vc: Build.true_() }] satisfies SynthResult;
		})
		.otherwise(function* () {
			throw new Error("synth: case not implemented for term " + run(() => EB.Display.Term(term)));
		});

	yield* logger.log(
		"Synthesized type",
		run(() => NF.display(result[0])),
	);
	yield* logger.exit();
	return result;
};

type StructRow = { row: NF.Row; vc: IVL.Formula };

const synthStructRow = function* (row: EB.Row): Verification<StructRow> {
	return yield* match(row)
		.with(Row.Patterns.NonEmpty, function* ({ entries: [{ label, value }, ...remaining] }) {
			const [ty, artefacts] = yield* synth(value);
			const fieldCtx = yield* reader.ask();
			const fieldValue = yield* NF.evaluate(value);
			const restResult = yield* reader.local(
				c => EB.extendSigma(EB.extendLabel(c, label, ty), Row.Constructors.Extension(label, fieldValue, Row.Constructors.Empty())),
				synthStructRow(Row.Constructors.Row(remaining, row.tail)),
			);
			return {
				row: Row.Constructors.Extension(label, ty, restResult.row),
				vc: Build.and(artefacts.vc, restResult.vc),
			} satisfies StructRow;
		})
		.with(Row.Patterns.Tail, function* ({ tail }) {
			const currentCtx = yield* reader.ask();
			return { row: Row.Constructors.Variable(toNFVariable(currentCtx, tail)), vc: Build.true_() } satisfies StructRow;
		})
		.otherwise(function* () {
			return { row: Row.Constructors.Empty(), vc: Build.true_() } satisfies StructRow;
		});
};

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
