import assert from "assert";
import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Row from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as E from "fp-ts/Either";
import * as F from "fp-ts/function";
import * as O from "fp-ts/Option";

import type { Bool, Context as Z3Context, Expr, Sort } from "z3-solver";

import { nextCount } from "@yap/elaboration/shared/supply";
import * as Err from "@yap/elaboration/shared/errors";
import { update } from "@yap/utils";

import type { VerificationArtefacts, CheckFn, SynthFn, SynthResult, SubtypeFn } from "./types";
import type { TranslationTools } from "./logic/translate";
import type { VerificationRuntime } from "./utils/context";
import { collectSigmaBindings, noCapture } from "./utils/context";
import { extractModalities, meet } from "./utils/refinements";
import { createSynth } from "./synth";
import { createSubtype } from "./subtype";

type CheckDeps = {
	Z3: Z3Context<"main">;
	runtime: VerificationRuntime;
	translation: TranslationTools;
};

export const createCheck = ({ Z3, runtime, translation }: CheckDeps) => {
	const synthPattern = createSynthPattern(Z3, runtime);
	const subtype = createSubtype({ Z3, runtime, translation });

	const check = (tm: EB.Term, ty: NF.Value): V2.Elaboration<VerificationArtefacts> =>
		V2.Do(function* () {
			const synth = createSynth({ Z3, runtime, translation });
			runtime.enter();
			const ctx = yield* V2.ask();
			runtime.log("Checking", EB.Display.Term(tm, ctx), "Against:", NF.display(ty, ctx), "Env:", EB.Display.Env(ctx));

			const result = match([tm, NF.force(ctx, ty)])
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

								const sortMap = translation.mkSort(type.binder.annotation, extended);
								const x = match(sortMap)
									.with({ Prim: P.select() }, sort => Z3.Const(term.binding.variable, sort))
									.with({ Func: P._ }, fn => {
										const sorts = translation.build(fn) as [Sort, ...Sort[], Sort];
										return Z3.Array.const(term.binding.variable, ...sorts);
									})
									.with({ App: P._ }, app => {
										const sorts = translation.build(app);
										const name = `App_${sorts.map(s => s.name()).join("_")}`;
										return Z3.Const(term.binding.variable, Z3.Sort.declare(name));
									})
									.with({ Recursive: P.select() }, sort => Z3.Const(term.binding.variable, sort))
									.with({ Row: P.select() }, sort => Z3.Const(term.binding.variable, sort))
									.otherwise(() => {
										throw new Error("Unsupported argument sort in function checking");
									});

								const lvl = extended.env.length;
								const applied = NF.apply(p.binder, p.closure, NF.Constructors.Rigid(lvl));
								const phi = translation.translate(applied, extended, { [lvl]: x }) as Bool;

								const imp = runtime.record("check.abs.quantification", Z3.ForAll([x], Z3.Implies(phi, artefacts.vc as Bool)) as Bool, {
									type: NF.display(type, ctx),
									description: `Function term must satisfy body's postcondition under the precondition on ${term.binding.variable}`,
								});

								return { vc: imp } satisfies VerificationArtefacts;
							}),
						),
					),
				)
				.with([EB.CtorPatterns.Array, NF.Patterns.Indexed], ([term, type]) => {
					return V2.of({
						vc: runtime.record("check.array", Z3.Bool.val(true), {
							type: NF.display(type, ctx),
							description: `Array term checked against indexed type`,
						}),
					} satisfies VerificationArtefacts);
				})
				.with([EB.CtorPatterns.Struct, NF.Patterns.Sigma], ([term, type]) => {
					const value = NF.evaluate(ctx, term);
					assert(value.type === "App" && value.arg.type === "Row", "Expected struct to evaluate to row application");
					const schema = NF.apply(type.binder, type.closure, NF.Constructors.Row(value.arg.row));
					return check(term, schema);
				})
				.with([EB.CtorPatterns.Struct, NF.Patterns.Variant], ([term, type]) => {
					const nf = NF.evaluate(ctx, term);
					assert(nf.type === "App" && nf.arg.type === "Row", "Expected struct term to evaluate to an application of a row");
					const contains = (a: NF.Row, b: EB.Row): V2.Elaboration<Bool> => {
						const onVal = (t: EB.Term, lbl: string, acc: V2.Elaboration<Bool>): V2.Elaboration<Bool> => {
							const rewritten = Row.rewrite(a, lbl, () => E.left({ tag: "Other", message: `Label ${lbl} not found.` }));
							return F.pipe(
								rewritten,
								E.fold(
									() => V2.Do(() => V2.fail({ type: "MissingLabel", label: lbl, row: a })),
									rewriteRes =>
										V2.Do(function* () {
											assert(rewriteRes.type === "extension", "Expected extension after rewriting row");
											const combined = yield* V2.pure(acc);
											const { vc } = yield* check.gen(t, rewriteRes.value);
											return Z3.And(combined, vc as Bool);
										}),
								),
							);
						};
						return Row.fold(b, onVal, (_rv, acc) => acc, V2.of(Z3.Bool.val(true)));
					};

					return V2.Do(function* () {
						const vc = yield* V2.pure(contains(type.arg.row, term.arg.row));
						return { vc } satisfies VerificationArtefacts;
					});
				})
				.with([EB.CtorPatterns.Struct, NF.Patterns.Schema], ([term, type]) => {
					const nf = NF.evaluate(ctx, term);
					const traverse = (r1: EB.Row, r2: NF.Row): V2.Elaboration<VerificationArtefacts> =>
						match([r1, r2])
							.with([{ type: "empty" }, { type: "empty" }], () => V2.of<VerificationArtefacts>({ vc: Z3.Bool.val(true) }))
							.with([{ type: "empty" }, { type: "variable" }], () => V2.of<VerificationArtefacts>({ vc: Z3.Bool.val(true) }))
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
									return { vc: Z3.And(artefacts.vc as Bool, rest.vc as Bool) } satisfies VerificationArtefacts;
								}),
							)
							.otherwise(() => V2.Do(() => V2.fail<VerificationArtefacts>({ type: "Impossible", message: "Schema verification: incompatible rows" })));

					const result = match(nf)
						.with(NF.Patterns.Struct, struct =>
							V2.Do(function* () {
								const bindings = yield* V2.pure(collectSigmaBindings(struct.arg.row, type.arg.row));
								return yield* V2.local(
									update("sigma", sigma => ({ ...sigma, ...bindings })),
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

								const quantifyBinders = (vc: Expr) =>
									binders
										.slice()
										.reverse()
										.reduce((acc, [name, binderTy]) => translation.quantify(name, binderTy, acc, ctx), vc);

								const freshVar = `$fresh${nextCount()}`;
								const vc = translation.quantify(freshVar, met, quantifyBinders(branchArtefacts.vc), ctx);
								const combinedVc = Z3.And(scrutineeArtefacts.vc as Bool, patternArtefacts.vc as Bool, vc as Bool);

								return { vc: combinedVc } satisfies VerificationArtefacts;
							});

						const alts = yield* V2.pure(V2.traverse(alternatives, checkAlt));
						const vc = alts.reduce((acc, artefact) => Z3.And(acc, artefact.vc as Bool), Z3.Bool.val(true));

						return { vc } satisfies VerificationArtefacts;
					}),
				)
				.otherwise(([term, type]) =>
					V2.Do(function* () {
						const [synthed, artefacts] = yield* synth.gen(term);
						// Since verification runs after typechecking, we can assume that the term has at least the type we are checking against
						// Therefore, we can lift it to have the type we are checking against, with the added synthed liquid refinement
						const checked = yield* subtype.gen(synthed, type);

						return { vc: Z3.And(artefacts.vc as Bool, checked as Bool), nf: synthed } satisfies VerificationArtefacts;
					}),
				);

			const t = yield* V2.pure(result);
			runtime.exit();
			return t;
		});

	check.gen = (term: EB.Term, type: NF.Value) => V2.pure(check(term, type));

	return check;

	function createSynthPattern(Z3Ctx: Z3Context<"main">, run: VerificationRuntime) {
		const synthPatternFn = (pattern: EB.Pattern, scrutineeTy: NF.Value): V2.Elaboration<[NF.Value, VerificationArtefacts]> =>
			V2.Do(function* () {
				const ctx = yield* V2.ask();
				return match(pattern)
					.with({ type: "Binder" }, () => [scrutineeTy, { vc: Z3Ctx.Bool.val(true) }] as [NF.Value, VerificationArtefacts])
					.with({ type: "Wildcard" }, () => [scrutineeTy, { vc: Z3Ctx.Bool.val(true) }] as [NF.Value, VerificationArtefacts])
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
						return [NF.Constructors.Modal(nf, modalities), { vc: Z3Ctx.Bool.val(true) }] as [NF.Value, VerificationArtefacts];
					})
					.otherwise(() => [scrutineeTy, { vc: Z3Ctx.Bool.val(true) }] as [NF.Value, VerificationArtefacts]);
			});

		return Object.assign(synthPatternFn, {
			gen(pattern: EB.Pattern, scrutineeTy: NF.Value) {
				return V2.pure(synthPatternFn(pattern, scrutineeTy));
			},
		});
	}
};
