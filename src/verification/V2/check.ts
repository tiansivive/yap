import assert from "assert";
import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Row from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";

import { nextCount } from "@yap/elaboration/shared/supply";
import * as Err from "@yap/elaboration/shared/errors";

import type { IVL } from "../solver/ivl/types";
import { Build } from "../solver/ivl/build";
import type { VerificationArtefacts } from "./types";
import type { TranslationTools } from "./logic/translate";
import type { VerificationRuntime } from "./utils/context";
import { collectSigmaBindings, noCapture } from "./utils/context";
import { extractModalities, meet } from "./utils/refinements";
import { createSynth } from "./synth";
import { createSubtype } from "./subtype";

type CheckDeps = {
	runtime: VerificationRuntime;
	translation: TranslationTools;
};

export const createCheck = ({ runtime, translation }: CheckDeps) => {
	const synthPattern = createSynthPattern(runtime);
	const subtype = createSubtype({ runtime, translation });

	const check = (tm: EB.Term, ty: NF.Value): V2.Elaboration<VerificationArtefacts> =>
		V2.Do(function* () {
			const synth = createSynth({ runtime, translation });
			runtime.enter();
			const ctx = yield* V2.ask();
			runtime.log("Checking", EB.Display.Term(tm, ctx), "Against:", NF.display(ty, ctx), "Env:", EB.Display.Env(ctx));

			const result = match([tm, NF.unwrapNeutral(NF.force(ctx, ty))])
				.with([{ type: "Modal" }, NF.Patterns.Type], ([term, type]) => check(term.term, type))
				.with([EB.CtorPatterns.Mu, P._], ([term, type]) =>
					V2.Do(() => V2.local(c => EB.bind(c, { type: "Mu", variable: term.binding.variable }, type), check(term.body, type))),
				)
				.with(
					[P._, NF.Patterns.App],
					([, type]) => O.isSome(NF.unfoldMu(type)),
					([term, type]) => {
						const unfolded = NF.unfoldMu(type);
						assert(unfolded._tag === "Some");
						return check(term, unfolded.value);
					},
				)
				.with([{ type: "Abs" }, { type: "Abs", binder: { type: "Pi" } }], ([term, type]) =>
					V2.Do(() =>
						V2.local(
							c => EB.bind(c, { type: "Lambda", variable: term.binding.variable }, type.binder.annotation),
							V2.Do(function* () {
								const extended = yield* V2.ask();
								const tyBody = NF.apply(type.binder, type.closure, NF.Constructors.Rigid(ctx.env.length));
								const artefacts = yield* check.gen(term.body, tyBody);

								const modalities = extractModalities(type.binder.annotation, extended);
								if (type.binder.annotation.type === "Abs") {
									return artefacts;
								}

								const p = modalities.liquid;
								assert(p.type === "Abs", "Liquid refinement must be unary");

								const sort = translation.mkSort(type.binder.annotation, extended);
								const x = Build.var_(term.binding.variable, sort);

								const lvl = extended.env.length;
								const applied = NF.apply(p.binder, p.closure, NF.Constructors.Rigid(lvl));
								const phi = translation.formula(applied, extended, { [lvl]: x });
								const imp = runtime.record(
									"check.abs.quantification",
									Build.forall([{ name: term.binding.variable, sort }], Build.implies(phi, artefacts.vc)),
									{
										type: NF.display(type, ctx),
										description: `Function term must satisfy body's postcondition under the precondition on ${term.binding.variable}`,
									},
								);

								return { vc: imp } satisfies VerificationArtefacts;
							}),
						),
					),
				)
				.with([EB.CtorPatterns.Array, NF.Patterns.Indexed], ([term, type]) => {
					return V2.of({
						vc: runtime.record("check.array", Build.true_(), {
							type: NF.display(type, ctx),
							description: `Array term checked against indexed type`,
						}),
					} satisfies VerificationArtefacts);
				})
				.with([EB.CtorPatterns.Struct, NF.Patterns.Sigma], ([term, type]) => {
					const value = NF.unwrapNeutral(NF.evaluate(ctx, term));
					assert(value.type === "App" && value.arg.type === "Row", "Expected struct to evaluate to row application");
					const schema = NF.apply(type.binder, type.closure, NF.Constructors.Row(value.arg.row));
					return check(term, schema);
				})
				.with([EB.CtorPatterns.Tagged, NF.Patterns.Variant], ([term, type]) => {
					return V2.Do(function* () {
						const value = EB.TaggedTerm.extract(term.arg.row);
						assert(value, "Tagged pattern expected __tag atom and payload fields");

						const label = value.label;
						const arm = Row.lookup(type.arg.row, label);

						if (!arm) {
							return yield* V2.fail<VerificationArtefacts>({ type: "MissingLabel", label, row: type.arg.row });
						}

						return yield* check.gen(value.payload, arm);
					});
				})
				.with([EB.CtorPatterns.Struct, NF.Patterns.Schema], ([term, type]) => {
					const nf = NF.unwrapNeutral(NF.evaluate(ctx, term));
					const traverse = (r1: EB.Row, r2: NF.Row): V2.Elaboration<VerificationArtefacts> =>
						match([r1, r2])
							.with([{ type: "empty" }, { type: "empty" }], () => V2.of<VerificationArtefacts>({ vc: Build.true_() }))
							.with([{ type: "empty" }, { type: "variable" }], () => V2.of<VerificationArtefacts>({ vc: Build.true_() }))
							.with([{ type: "extension" }, { type: "extension" }], ([{ label, value, row }, r]) =>
								V2.Do(function* () {
									const rewritten = Row.rewrite(r, label);
									if (E.isLeft(rewritten)) {
										return yield* V2.fail<VerificationArtefacts>(Err.MissingLabel(label, r));
									}
									if (rewritten.right.type !== "extension") {
										return yield* V2.fail<VerificationArtefacts>({ type: "Impossible", message: "Row rewrite should yield extension" });
									}
									const { value: rv, row: rr } = rewritten.right;
									const artefacts = yield* check.gen(value, rv);
									const rest = yield* V2.pure(traverse(row, rr));
									return { vc: Build.and(artefacts.vc, rest.vc) } satisfies VerificationArtefacts;
								}),
							)
							.otherwise(() => V2.Do(() => V2.fail<VerificationArtefacts>({ type: "Impossible", message: "Schema verification: incompatible rows" })));

					const result = match(nf)
						.with(NF.Patterns.Struct, struct =>
							V2.Do(function* () {
								const bindings = yield* V2.pure(collectSigmaBindings(struct.arg.row, type.arg.row));
								return yield* V2.local(
									ctx => ({
										...ctx,
										labels: { ...ctx.labels, ...bindings.labels },
										sigma: { ...ctx.sigma, ...bindings.sigma },
									}),
									traverse(term.arg.row, type.arg.row),
								);
							}),
						)
						.otherwise(() => {
							throw new Error("Schema verification: expected struct term");
						});

					return result;
				})
				.with([EB.CtorPatterns.Match, P._], ([term, type]) =>
					V2.Do(function* () {
						const { alternatives, scrutinee } = term;

						runtime.log("-------------------------------------------");
						runtime.log("Match: Scrutinee");
						runtime.log("-------------------------------------------");

						const [scrutineeTy, scrutineeArtefacts] = yield* synth.gen(scrutinee);

						runtime.log("-------------------------------------------");
						runtime.log("Match: Alternatives");
						runtime.log("-------------------------------------------");

						const checkAlt = (alt: EB.Alternative): V2.Elaboration<VerificationArtefacts> =>
							V2.Do(function* () {
								const ctx = yield* V2.ask();
								const { pattern, term: branch, binders } = alt;

								runtime.log("Checking alternative:", EB.Display.Pattern(pattern), "=>", EB.Display.Term(branch, ctx));

								const [patternTy, patternArtefacts] = yield* synthPattern.gen(pattern, scrutineeTy);
								const met = meet(ctx, scrutineeTy, patternTy);

								runtime.log("Met type:", NF.display(met, ctx));

								const extendCtx = (context: EB.Context) => binders.reduce((c, [name, ty]) => EB.bind(c, { type: "Lambda", variable: name }, ty), context);

								const branchArtefacts = yield* V2.local(extendCtx, check(branch, type));

								const quantifyBinders = (vc: IVL.Formula) =>
									binders
										.slice()
										.reverse()
										.reduce((acc, [name, binderTy]) => translation.quantify(name, binderTy, acc, ctx), vc);

								const freshVar = `$fresh${nextCount()}`;
								const vc = translation.quantify(freshVar, met, quantifyBinders(branchArtefacts.vc), ctx);
								const combinedVc = Build.and(scrutineeArtefacts.vc, patternArtefacts.vc, vc);

								return { vc: combinedVc } satisfies VerificationArtefacts;
							});

						const alts = yield* V2.pure(V2.traverse(alternatives, checkAlt));
						const vc = Build.andWithOrigin(alts.map(a => a.vc));

						return { vc } satisfies VerificationArtefacts;
					}),
				)
				.otherwise(([term, type]) =>
					V2.Do(function* () {
						const [synthed, artefacts] = yield* synth.gen(term);
						const checked = yield* subtype.gen(synthed, type);

						return { vc: Build.and(artefacts.vc, checked), nf: synthed } satisfies VerificationArtefacts;
					}),
				);

			const t = yield* V2.pure(result);
			runtime.exit();
			return t;
		});

	check.gen = (term: EB.Term, type: NF.Value) => V2.pure(check(term, type));

	return check;

	function createSynthPattern(run: VerificationRuntime) {
		const synthPatternFn = (pattern: EB.Pattern, scrutineeTy: NF.Value): V2.Elaboration<[NF.Value, VerificationArtefacts]> =>
			V2.Do(function* () {
				const ctx = yield* V2.ask();
				return match(pattern)
					.with({ type: "Binder" }, () => [scrutineeTy, { vc: Build.true_() }] as [NF.Value, VerificationArtefacts])
					.with({ type: "Wildcard" }, () => [scrutineeTy, { vc: Build.true_() }] as [NF.Value, VerificationArtefacts])
					.with({ type: "Lit" }, p => {
						const ann = match(p.value)
							.with({ type: "Atom" }, l => EB.Constructors.Lit(l))
							.with({ type: "Num" }, () => EB.Constructors.Lit({ type: "Atom", value: "Num" }))
							.with({ type: "String" }, () => EB.Constructors.Lit({ type: "Atom", value: "String" }))
							.with({ type: "Bool" }, () => EB.Constructors.Lit({ type: "Atom", value: "Bool" }))
							.with({ type: "unit" }, () => EB.Constructors.Lit({ type: "Atom", value: "Unit" }))
							.exhaustive();
						const nf = NF.evaluate(ctx, ann);
						const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
						const litTerm = EB.Constructors.Lit(p.value);
						const closure = NF.Constructors.Closure(noCapture(ctx), EB.DSL.eq(bound, litTerm));
						const fresh = run.freshName();
						const modalities = {
							quantity: Q.Many,
							liquid: NF.Constructors.Lambda(fresh, "Explicit", closure, nf),
						};
						return [NF.Constructors.Modal(nf, modalities), { vc: Build.true_() }] as [NF.Value, VerificationArtefacts];
					})
					.otherwise(() => [scrutineeTy, { vc: Build.true_() }] as [NF.Value, VerificationArtefacts]);
			});

		return Object.assign(synthPatternFn, {
			gen(pattern: EB.Pattern, scrutineeTy: NF.Value) {
				return V2.pure(synthPatternFn(pattern, scrutineeTy));
			},
		});
	}
};
