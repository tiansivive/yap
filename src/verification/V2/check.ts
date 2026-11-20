import assert from "assert";
import { isMatching, match, P } from "ts-pattern";

import * as Eff from "@yap/utils/effects";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Row from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as E from "fp-ts/Either";

import type { IVL } from "../solver/ivl/types";
import { Build } from "../solver/ivl/build";
import { type Checked, type VerificationArtefacts } from "./types";
import { reader, fail, logger, obligations, supply, type Verification } from "./effects";
import { collectSigmaBindings, noCapture } from "./utils/context";
import { meet } from "./utils/refinements";
import { synth } from "./synth";
import * as Binder from "./binders";
import { subsume, subtype } from "./subtype";
import { quantify, scope } from "./logic/translate";

export function* check(tm: EB.Term, ty: NF.Value): Verification<Checked> {
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
	const result = yield* match([tm, viewed])
		.with([{ type: "Ann" }, P._], function* ([{ term, ann }]) {
			const declared = yield* NF.evaluate(ann);
			const checked = yield* ascribe(term, declared);
			const vc = yield* subtype(declared, ty);
			return { type: checked.type, vc: Build.and(checked.vc, vc) };
		})
		.with([P._, NF.View.Sealed()], function* ([, { value: type }]) {
			return yield* match([tm, type])
				.with([EB.CtorPatterns.Pi, NF.Patterns.Type], function* ([{ binding, body }]) {
					const domain = yield* check(binding.annotation, NF.Type);
					const result = yield* checkBodyType(binding, yield* NF.evaluate(binding.annotation), body);
					return { vc: Build.and(domain.vc, result) };
				})
				.with([EB.CtorPatterns.Phi, NF.Patterns.Type], function* ([{ binding, body }]) {
					const kind = yield* check(binding.annotation, NF.Type);
					const result = yield* checkBodyType(binding, yield* NF.evaluate(binding.annotation), body);
					return { vc: Build.and(kind.vc, result) };
				})
				.with([EB.CtorPatterns.Psi, NF.Patterns.Type], function* ([{ binding, body }]) {
					const requirement = binding.requirement && (yield* NF.evaluate(binding.requirement));
					const state = requirement ? NF.Constructors.Modal(NF.State, { quantity: Q.Many, liquid: requirement }) : NF.State;
					return { vc: yield* checkBodyType(binding, state, body) };
				})
				.with([{ type: "Lit", value: { type: "Atom" } }, NF.Patterns.Type], function* () {
					return { vc: Build.true_() };
				})
				.with([{ type: "Modal" }, NF.Patterns.Type], ([term]) => check(term.term, NF.Type))
				.with([EB.CtorPatterns.Mu, P._], function* ([term, type]) {
					return {
						vc: (yield* scope(yield* supply.freshFrom(term.binding.variable), { type: "Mu", variable: term.binding.variable }, type, check(term.body, type)))
							.vc,
					};
				})
				.with(
					[P._, NF.Patterns.App],
					([, type]) => p(() => NF.unfoldMu(type)) !== undefined,
					function* ([term, type]) {
						const unfolded = yield* NF.unfoldMu(type);
						assert(unfolded !== undefined);
						return { vc: (yield* check(term, unfolded)).vc };
					},
				)
				.with([EB.CtorPatterns.Psi, NF.Patterns.Psi], function* ([{ binding, body }, { binder, closure }]) {
					const state = binder.requirement ? NF.Constructors.Modal(NF.State, { quantity: Q.Many, liquid: binder.requirement }) : NF.State;
					const name = yield* supply.freshFrom(binding.variable);
					const expected = yield* NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length));
					const checked = yield* scope(name, binding, state, ascribe(body, expected));
					const type = NF.Constructors.Psi(binding.variable, binder.requirement, yield* NF.closeVal(checked.type));
					return { type, vc: yield* quantify(name, state, checked.vc) };
				})
				.with(
					[EB.CtorPatterns.Lambda, { type: "Abs", binder: { type: "Pi", icit: "Explicit", annotation: NF.Patterns.Modal } }],
					function* ([{ binding, body }, pi]) {
						const parameter = yield* check(binding.annotation, NF.Type);
						const domain = yield* Binder.modalInput(pi.binder.annotation);
						const expected = yield* NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(ctx.env.length));
						const name = yield* supply.freshFrom(binding.variable);
						const checked = yield* scope(name, binding, domain, ascribe(body, expected));
						const type = NF.Constructors.Pi(binding.variable, pi.binder.icit, domain, yield* NF.closeVal(checked.type));
						return { type, vc: Build.and(parameter.vc, yield* quantify(name, domain, checked.vc)) };
					},
				)
				.with([EB.CtorPatterns.Lambda, { type: "Abs", binder: { type: "Pi", icit: "Explicit" } }], function* ([{ binding, body }, pi]) {
					const parameter = yield* check(binding.annotation, NF.Type);
					const domain = yield* Binder.input(pi.binder.annotation);
					const expected = yield* NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(ctx.env.length));
					const name = yield* supply.freshFrom(binding.variable);
					const checked = yield* scope(name, binding, domain, ascribe(body, expected));
					const type = NF.Constructors.Pi(binding.variable, pi.binder.icit, domain, yield* NF.closeVal(checked.type));
					return { type, vc: Build.and(parameter.vc, yield* quantify(name, domain, checked.vc)) };
				})
				.with([EB.CtorPatterns.Lambda, { type: "Abs", binder: { type: "Pi", icit: "Implicit" } }], function* ([{ binding, body }, pi]) {
					const parameter = yield* check(binding.annotation, NF.Type);
					const domain = pi.binder.annotation;
					const expected = yield* NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(ctx.env.length));
					const name = yield* supply.freshFrom(binding.variable);
					const checked = yield* scope(name, binding, domain, ascribe(body, expected));
					const type = NF.Constructors.Pi(binding.variable, pi.binder.icit, domain, yield* NF.closeVal(checked.type));
					return { type, vc: Build.and(parameter.vc, yield* quantify(name, domain, checked.vc)) };
				})
				.with([P.union(EB.CtorPatterns.Array, EB.CtorPatterns.Nu, EB.CtorPatterns.Struct, EB.CtorPatterns.Tagged), P._], function* ([term, type]) {
					const { vc } = yield* checkData(term, type);
					return { vc };
				})
				.with([EB.CtorPatterns.Match, P._], function* ([term, _type]) {
					return yield* matches(term, type);
				})
				.otherwise(function* ([term, type]) {
					return yield* fallback(term, type);
				});
		})
		.otherwise(function* ([, { value: type }]) {
			return yield* match(tm)
				.with(EB.CtorPatterns.Mu, function* (term) {
					return {
						vc: (yield* scope(yield* supply.freshFrom(term.binding.variable), { type: "Mu", variable: term.binding.variable }, type, check(term.body, type)))
							.vc,
					};
				})
				.with(EB.CtorPatterns.Match, function* (term) {
					return yield* matches(term, type);
				})
				.otherwise(function* (term) {
					return yield* fallback(term, type);
				});
		});

	yield* logger.exit();
	return { type: ty, ...result };

	function* checkBodyType(binding: EB.Binding, domain: NF.Value, body: EB.Term): Verification<IVL.Formula> {
		const name = yield* supply.freshFrom(binding.variable);
		const checked = yield* scope(name, binding, domain, check(body, NF.Type));
		return checked.vc.tag === "True" ? checked.vc : yield* quantify(name, domain, checked.vc);
	}

	function* fallback(term: EB.Term, type: NF.Value): Verification<Checked> {
		const [synthed, artefacts] = yield* synth(term);
		const checked = yield* subtype(synthed, type);
		return { vc: Build.and(artefacts.vc, checked), type: synthed };
	}

	function* checkData(term: EB.Term, type: NF.Value): Verification<VerificationArtefacts> {
		return yield* match([term, type])
			.with([EB.CtorPatterns.Array, NF.Patterns.Indexed], function* ([_term, type]) {
				const vc = yield* obligations.record("check.array", Build.true_(), {
					type: p(() => NF.display(type)),
					description: `Array term checked against indexed type`,
				});
				return { vc } satisfies VerificationArtefacts;
			})
			.with([EB.CtorPatterns.Nu, NF.Patterns.Schema], function* ([term, type]) {
				// TODO: lazy records, once some syntax can build one
				assert(term.binding.mode === "strict", "Verification supports strict records only");
				return yield* reader.local(c => EB.open(term.binding, c), check(term.body, type));
			})
			.with([EB.CtorPatterns.Struct, NF.Patterns.Sigma], function* ([term, type]) {
				const evaluated = yield* NF.evaluate(term);
				const innerViewed = yield* NF.view(evaluated);
				const schema = yield* match(innerViewed)
					.with(NF.View.Sealed(NF.Patterns.Struct), function* ({ value }) {
						return yield* NF.apply(type.binder, type.closure, NF.Constructors.Row(value.arg.row));
					})
					.otherwise(function* () {
						throw new Error("Expected struct to evaluate to a sealed struct");
					});
				return yield* check(term, schema);
			})
			.with([P.union(EB.CtorPatterns.Struct, EB.CtorPatterns.Nu), NF.Patterns.SigmaV2], function* ([term, type]) {
				const evaluated = yield* NF.evaluate(term);
				const innerViewed = yield* NF.view(evaluated);
				return yield* match(innerViewed)
					.with(NF.View.Sealed(NF.Patterns.Struct), function* ({ value }) {
						const schema = yield* NF.apply(type.binder, type.closure, NF.Constructors.Row(value.arg.row));
						return yield* match(yield* NF.rowOf(schema))
							.with(P.nonNullable, () => check(term, schema))
							.otherwise(function* () {
								throw new Error("SigmaV2 closure expected a Schema body");
							});
					})
					.otherwise(function* () {
						throw new Error("Expected struct to evaluate to a sealed struct");
					});
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
					return yield* match<readonly [EB.Row, NF.Row], Verification<VerificationArtefacts>>([r1, r2])
						.with([Row.Patterns.Empty, Row.Patterns.Empty], [Row.Patterns.Empty, Row.Patterns.Tail], function* () {
							return { vc: Build.true_() } satisfies VerificationArtefacts;
						})
						.with(
							[Row.Patterns.NonEmpty, Row.Patterns.NonEmpty],
							function* ([
								{
									entries: [{ label, value }, ...remaining],
								},
							]) {
								const rewritten = Row.rewrite(r2, label);
								if (E.isLeft(rewritten)) {
									return yield* fail({ type: "MissingLabel", label, row: r2 });
								}
								const artefacts = yield* check(value, rewritten.right.value);
								const rest = yield* traverse(Row.Constructors.Row(remaining, r1.tail), rewritten.right.rest);
								return { vc: Build.and(artefacts.vc, rest.vc) } satisfies VerificationArtefacts;
							},
						)
						.otherwise(function* () {
							return yield* fail({ type: "Impossible", message: "Schema verification: incompatible rows" });
						});
				};

				const evaluated = yield* NF.evaluate(term);
				const innerViewed = yield* NF.view(evaluated);
				return yield* match(innerViewed)
					.with(NF.View.Sealed(NF.Patterns.Struct), function* ({ value: struct }) {
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
			.otherwise(([term, type]) => fallback(term, type));
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

			const telescope = function* (remaining: typeof binders): Verification<IVL.Formula> {
				return yield* match(remaining)
					.with([], function* () {
						return (yield* check(branch, type)).vc;
					})
					.otherwise(function* ([[variable, binderTy], ...rest]) {
						const name = yield* supply.freshFrom(variable);
						const vc = yield* scope(name, { type: "Lambda", variable }, binderTy, telescope(rest));
						return yield* quantify(name, binderTy, vc);
					});
			};

			const quantified = yield* telescope(binders);

			const freshVar = yield* supply.freshNum();
			const vc = yield* quantify(freshVar, met, quantified);
			const combinedVc = Build.and(scrutineeArtefacts.vc, patternArtefacts.vc, vc);

			return { vc: combinedVc } satisfies VerificationArtefacts;
		};

		const alts = yield* Eff.traverse(alternatives, checkAlt);
		const vc = Build.andWithOrigin(alts.map(a => a.vc));

		return { vc } satisfies VerificationArtefacts;
	}
}

/** The annotation fixes a value's result. A function already in scope can supply its omitted callback preconditions. */
export function* ascribe(term: EB.Term, declared: NF.Value): Verification<Checked> {
	const head = yield* NF.view(yield* NF.bare(declared));
	if (!isMatching(NF.View.Sealed(NF.Patterns.FunctionType), head)) {
		const { vc } = yield* check(term, declared);
		return { type: declared, vc };
	}
	return yield* match([term, yield* NF.view(declared)])
		.with(
			[P.union(EB.CtorPatterns.Lambda, EB.CtorPatterns.Psi), NF.View.Sealed({ type: "Modal", modalities: { liquid: P.nullish } })],
			function* ([term, { value }]) {
				const checked = yield* ascribe(term, value.value);
				return { type: NF.Constructors.Modal(checked.type, value.modalities), vc: checked.vc };
			},
		)
		.with([P.union(EB.CtorPatterns.Lambda, EB.CtorPatterns.Psi, EB.CtorPatterns.Mu, EB.CtorPatterns.Match), P._], () => check(term, declared))
		.otherwise(function* ([term]) {
			const [inferred, proof] = yield* synth(term);
			const checked = yield* subsume(inferred, declared);
			return { type: checked.right, vc: Build.and(proof.vc, checked.vc) };
		});
}

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
