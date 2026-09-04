import assert from "assert";
import { match, P } from "ts-pattern";

import * as Eff from "@yap/utils/effects";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Row from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as E from "fp-ts/Either";

import type { IVL } from "../solver/ivl/types";
import { Build } from "../solver/ivl/build";
import type { VerificationArtefacts } from "./types";
import { reader, fail, logger, obligations, supply, type Verification } from "./effects";
import { collectSigmaBindings, noCapture } from "./utils/context";
import { extractModalities, meet } from "./utils/refinements";
import { synth } from "./synth";
import { subtype } from "./subtype";
import { mkSort, formula, quantify } from "./logic/translate";

export const check = function* (tm: EB.Term, ty: NF.Value): Verification<VerificationArtefacts> {
	yield* logger.enter();
	const ctx = yield* reader.ask();
	const registry = yield* Metas.registry.get();
	const p = NF.probe(ctx, registry);

	yield* logger.log(
		"Checking",
		p(() => EB.Display.Term(tm)),
		"Against:",
		p(() => NF.display(ty)),
		"Env:",
		EB.Display.Env(ctx.env),
	);

	const viewed = yield* NF.view(ty);
	const result = yield* match(viewed)
		.with({ kind: "Sealed" }, function* ({ value: type }) {
			return yield* match([tm, type])
				.with([{ type: "Modal" }, NF.Patterns.Type], function* ([term, type]) {
					return yield* check(term.term, type);
				})
				.with([EB.CtorPatterns.Mu, P._], function* ([term, type]) {
					return yield* reader.local(c => EB.bind(c, { type: "Mu", variable: term.binding.variable }, type), check(term.body, type));
				})
				.with(
					[P._, NF.Patterns.App],
					([, type]) => p(() => NF.unfoldMu(type)) !== undefined,
					function* ([term, type]) {
						const unfolded = yield* NF.unfoldMu(type);
						assert(unfolded !== undefined);
						return yield* check(term, unfolded);
					},
				)
				.with([{ type: "Abs" }, { type: "Abs", binder: { type: "Pi" } }], function* ([term, type]) {
					return yield* reader.local(
						c => EB.bind(c, { type: "Lambda", variable: term.binding.variable }, type.binder.annotation),
						(function* () {
							const extended = yield* reader.ask();
							const tyBody = yield* NF.apply(type.binder, type.closure, NF.Constructors.Rigid(ctx.env.length));
							const artefacts = yield* check(term.body, tyBody);

							const modalities = extractModalities(type.binder.annotation, extended);
							if (type.binder.annotation.type === "Abs") {
								return artefacts;
							}

							const liq = modalities.liquid;
							assert(liq.type === "Abs", "Liquid refinement must be unary");

							const sort = yield* mkSort(type.binder.annotation);
							const x = Build.var_(term.binding.variable, sort);

							const lvl = extended.env.length;
							const applied = yield* NF.apply(liq.binder, liq.closure, NF.Constructors.Rigid(lvl));
							const phi = yield* formula(applied, { [lvl]: x });
							const imp = yield* obligations.record(
								"check.abs.quantification",
								Build.forall([{ name: term.binding.variable, sort }], Build.implies(phi, artefacts.vc)),
								{
									type: p(() => NF.display(type)),
									description: `Function term must satisfy body's postcondition under the precondition on ${term.binding.variable}`,
								},
							);

							return { vc: imp } satisfies VerificationArtefacts;
						})(),
					);
				})
				.with([EB.CtorPatterns.Array, NF.Patterns.Indexed], function* ([_term, type]) {
					const vc = yield* obligations.record("check.array", Build.true_(), {
						type: p(() => NF.display(type)),
						description: `Array term checked against indexed type`,
					});
					return { vc } satisfies VerificationArtefacts;
				})
				.with([EB.CtorPatterns.Struct, NF.Patterns.Sigma], function* ([term, type]) {
					const evaluated = yield* NF.evaluate(term);
					const innerViewed = yield* NF.view(evaluated);
					const schema = yield* match(innerViewed)
						.with({ kind: "Sealed", value: NF.Patterns.Struct }, function* ({ value }) {
							return yield* NF.apply(type.binder, type.closure, NF.Constructors.Row(value.arg.row));
						})
						.otherwise(function* () {
							throw new Error("Expected struct to evaluate to a sealed struct");
						});
					return yield* check(term, schema);
				})
				.with([EB.CtorPatterns.Tagged, NF.Patterns.Variant], function* ([term, type]) {
					const value = EB.TaggedTerm.extract(term.arg.row);
					assert(value, "Tagged pattern expected __tag atom and payload fields");

					const label = value.label;
					const arm = Row.lookup(type.arg.row, label);

					if (!arm) {
						return yield* fail({ type: "MissingLabel", label, row: type.arg.row });
					}

					return yield* check(value.payload, arm);
				})
				.with([EB.CtorPatterns.Struct, NF.Patterns.Schema], function* ([term, type]) {
					const traverse = function* (r1: EB.Row, r2: NF.Row): Verification<VerificationArtefacts> {
						return yield* match<[EB.Row, NF.Row], Verification<VerificationArtefacts>>([r1, r2])
							.with([{ type: "empty" }, { type: "empty" }], function* () {
								return { vc: Build.true_() } satisfies VerificationArtefacts;
							})
							.with([{ type: "empty" }, { type: "variable" }], function* () {
								return { vc: Build.true_() } satisfies VerificationArtefacts;
							})
							.with([{ type: "extension" }, { type: "extension" }], function* ([{ label, value, row }, r]) {
								const rewritten = Row.rewrite(r, label);
								if (E.isLeft(rewritten)) {
									return yield* fail({ type: "MissingLabel", label, row: r });
								}
								if (rewritten.right.type !== "extension") {
									return yield* fail({ type: "Impossible", message: "Row rewrite should yield extension" });
								}
								const { value: rv, row: rr } = rewritten.right;
								const artefacts = yield* check(value, rv);
								const rest = yield* traverse(row, rr);
								return { vc: Build.and(artefacts.vc, rest.vc) } satisfies VerificationArtefacts;
							})
							.otherwise(function* () {
								return yield* fail({ type: "Impossible", message: "Schema verification: incompatible rows" });
							});
					};

					const evaluated = yield* NF.evaluate(term);
					const innerViewed = yield* NF.view(evaluated);
					return yield* match(innerViewed)
						.with({ kind: "Sealed", value: NF.Patterns.Struct }, function* ({ value: struct }) {
							const bindings = yield* collectSigmaBindings(struct.arg.row, type.arg.row);
							return yield* reader.local(
								c => ({
									...c,
									labels: { ...c.labels, ...bindings.labels },
									sigma: { ...c.sigma, ...bindings.sigma },
								}),
								traverse(term.arg.row, type.arg.row),
							);
						})
						.otherwise(function* () {
							throw new Error("Schema verification: expected struct term");
						});
				})
				.with([EB.CtorPatterns.Match, P._], function* ([term, _type]) {
					return yield* matches(term, type);
				})
				.otherwise(function* ([term, type]) {
					return yield* fallback(term, type);
				});
		})
		.otherwise(function* ({ value: type }) {
			return yield* match(tm)
				.with(EB.CtorPatterns.Mu, function* (term) {
					return yield* reader.local(c => EB.bind(c, { type: "Mu", variable: term.binding.variable }, type), check(term.body, type));
				})
				.with(EB.CtorPatterns.Match, function* (term) {
					return yield* matches(term, type);
				})
				.otherwise(function* (term) {
					return yield* fallback(term, type);
				});
		});

	yield* logger.exit();
	return result;

	function* fallback(term: EB.Term, type: NF.Value): Verification<VerificationArtefacts> {
		const [synthed, artefacts] = yield* synth(term);
		const checked = yield* subtype(synthed, type);
		return { vc: Build.and(artefacts.vc, checked), nf: synthed } satisfies VerificationArtefacts;
	}

	function* matches(term: EB.Term & { type: "Match" }, type: NF.Value): Verification<VerificationArtefacts> {
		const { alternatives, scrutinee } = term;

		yield* logger.log("-------------------------------------------");
		yield* logger.log("Match: Scrutinee");
		yield* logger.log("-------------------------------------------");

		const [scrutineeTy, scrutineeArtefacts] = yield* synth(scrutinee);

		yield* logger.log("-------------------------------------------");
		yield* logger.log("Match: Alternatives");
		yield* logger.log("-------------------------------------------");

		const checkAlt = function* (alt: EB.Alternative): Verification<VerificationArtefacts> {
			const altCtx = yield* reader.ask();
			const altRegistry = yield* Metas.registry.get();
			const altP = NF.probe(altCtx, altRegistry);
			const { pattern, term: branch, binders } = alt;

			yield* logger.log(
				"Checking alternative:",
				EB.Display.Pattern(pattern),
				"=>",
				altP(() => EB.Display.Term(branch)),
			);

			const [patternTy, patternArtefacts] = yield* synthPattern(pattern, scrutineeTy);
			const met = yield* meet(scrutineeTy, patternTy);

			yield* logger.log(
				"Met type:",
				altP(() => NF.display(met)),
			);

			const extendCtx = (context: EB.Context) => binders.reduce((c, [name, ty]) => EB.bind(c, { type: "Lambda", variable: name }, ty), context);

			const branchArtefacts = yield* reader.local(extendCtx, check(branch, type));

			/* Quantify innermost binder first: fold right over the binder telescope. */
			const quantified = yield* binders.reduceRight<Verification<IVL.Formula>>(
				(acc, [name, binderTy]) =>
					(function* (): Verification<IVL.Formula> {
						return yield* quantify(name, binderTy, yield* acc);
					})(),
				Eff.of(branchArtefacts.vc),
			);

			const freshVar = yield* supply.freshNum();
			const vc = yield* quantify(freshVar, met, quantified);
			const combinedVc = Build.and(scrutineeArtefacts.vc, patternArtefacts.vc, vc);

			return { vc: combinedVc } satisfies VerificationArtefacts;
		};

		const alts = yield* Eff.traverse(alternatives, checkAlt);
		const vc = Build.andWithOrigin(alts.map(a => a.vc));

		return { vc } satisfies VerificationArtefacts;
	}
};

const synthPattern = function* (pattern: EB.Pattern, scrutineeTy: NF.Value): Verification<[NF.Value, VerificationArtefacts]> {
	const ctx = yield* reader.ask();
	return yield* match(pattern)
		.with({ type: "Binder" }, function* () {
			return [scrutineeTy, { vc: Build.true_() }] as [NF.Value, VerificationArtefacts];
		})
		.with({ type: "Wildcard" }, function* () {
			return [scrutineeTy, { vc: Build.true_() }] as [NF.Value, VerificationArtefacts];
		})
		.with({ type: "Lit" }, function* (pat) {
			const ann = match(pat.value)
				.with({ type: "Atom" }, l => EB.Constructors.Lit(l))
				.with({ type: "Num" }, () => EB.Constructors.Lit({ type: "Atom", value: "Num" }))
				.with({ type: "String" }, () => EB.Constructors.Lit({ type: "Atom", value: "String" }))
				.with({ type: "Bool" }, () => EB.Constructors.Lit({ type: "Atom", value: "Bool" }))
				.with({ type: "unit" }, () => EB.Constructors.Lit({ type: "Atom", value: "Unit" }))
				.exhaustive();
			const nf = yield* NF.evaluate(ann);
			const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
			const litTerm = EB.Constructors.Lit(pat.value);
			const closure = NF.Constructors.Closure(noCapture(ctx), EB.DSL.eq(bound, litTerm));
			const freshName = yield* supply.fresh();
			const modalities = {
				quantity: Q.Many,
				liquid: NF.Constructors.Lambda(freshName, "Explicit", closure, nf),
			};
			return [NF.Constructors.Modal(nf, modalities), { vc: Build.true_() }] as [NF.Value, VerificationArtefacts];
		})
		.otherwise(function* () {
			return [scrutineeTy, { vc: Build.true_() }] as [NF.Value, VerificationArtefacts];
		});
};
