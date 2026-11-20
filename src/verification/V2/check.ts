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
import { Liquid } from "../modalities";
import { Build } from "../solver/ivl/build";
import { type Checked, type VerificationArtefacts } from "./types";
import { reader, state, fail, logger, obligations, supply, type Verification } from "./effects";
import { collectSigmaBindings, noCapture } from "./utils/context";
import { meet } from "./utils/refinements";
import { synth } from "./synth";
import * as Binder from "./binders";
import { subtype } from "./subtype";
import { quantify, scope } from "./logic/translate";

type Formation = { openInputs: boolean; actual?: NF.Value };
type Formed = VerificationArtefacts & { value: NF.Value };

export function* check(tm: EB.Term, ty: NF.Value, formation?: Formation): Verification<Checked> {
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
			const body = yield* check(term, declared);
			const vc = yield* subtype(declared, ty);
			const annotation = yield* ascribed(declared, body);
			return { vc: Build.and(annotation.vc, vc), type: { source: "synthesis", value: annotation.value } } satisfies Checked;
		})
		.with([P._, NF.View.Sealed()], function* ([, { value: type }]) {
			return yield* match([tm, type])
				.with([EB.CtorPatterns.Pi, NF.Patterns.Type], [EB.CtorPatterns.Phi, NF.Patterns.Type], [EB.CtorPatterns.Psi, NF.Patterns.Type], function* ([term]) {
					return yield* form(term, formation);
				})
				.with([{ type: "Lit", value: { type: "Atom" } }, NF.Patterns.Type], function* ([term]) {
					return { vc: Build.true_(), value: yield* NF.evaluate(term) };
				})
				.with([{ type: "Modal" }, NF.Patterns.Type], function* ([term]) {
					const base = yield* typeTerm(term.term, formation);
					const wrapped = EB.Constructors.Modal(yield* NF.quote(ctx.env.length, base.value), term.modalities);
					return { vc: base.vc, value: yield* NF.evaluate(wrapped) };
				})
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
				.with([EB.CtorPatterns.Psi, NF.Patterns.Psi], [{ type: "Abs" }, NF.Patterns.Pi], function* ([term, type]) {
					const domain = yield* match(type.binder)
						.with({ type: "Pi", icit: "Explicit" }, function* (pi) {
							return yield* parameter(yield* NF.quote(ctx.env.length, pi.annotation));
						})
						.otherwise(function* (binder) {
							return { value: binder.annotation, vc: Build.true_() };
						});
					const binder = { ...type.binder, variable: term.binding.variable, annotation: domain.value };
					const annotation = Binder.annotation(binder);
					const name = yield* supply.freshFrom(binder.variable);
					const expected = yield* NF.apply(type.binder, type.closure, NF.Constructors.Rigid(ctx.env.length));
					const body = yield* scope(
						name,
						binder,
						annotation,
						(function* () {
							const checked = yield* check(term.body, expected);
							return yield* ascribed(expected, checked);
						})(),
					);
					const closure = yield* NF.closeVal(body.value);
					const vc = yield* quantify(name, annotation, body.vc);
					return { vc: Build.and(domain.vc, vc), type: { source: "checking", value: NF.mk({ type: "Abs", binder, closure }) } } satisfies Checked;
				})
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
					return { vc: (yield* reader.local(c => EB.open(term.binding, c), check(term.body, type))).vc };
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
					return { vc: (yield* check(term, schema)).vc };
				})
				.with([P.union(EB.CtorPatterns.Struct, EB.CtorPatterns.Nu), NF.Patterns.SigmaV2], function* ([term, type]) {
					const evaluated = yield* NF.evaluate(term);
					const innerViewed = yield* NF.view(evaluated);
					return yield* match(innerViewed)
						.with(NF.View.Sealed(NF.Patterns.Struct), function* ({ value }) {
							const schema = yield* NF.apply(type.binder, type.closure, NF.Constructors.Row(value.arg.row));
							return yield* match(yield* NF.rowOf(schema))
								.with(P.nonNullable, function* () {
									return { vc: (yield* check(term, schema)).vc };
								})
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

					return { vc: (yield* check(value.payload, arm)).vc };
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
	return result;

	function* fallback(term: EB.Term, type: NF.Value): Verification<Checked> {
		const [synthed, artefacts] = yield* synth(term);
		const checked = yield* subtype(synthed, type);
		return { vc: Build.and(artefacts.vc, checked), type: { source: "synthesis", value: synthed } };
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

/** A written ascription keeps its specified result and inherits refinements at its open callback inputs. */
export function* ascribed(declared: NF.Value, checked: Checked): Verification<Formed> {
	if (!checked.type) {
		return { value: declared, vc: checked.vc };
	}

	if (checked.type.source === "checking") {
		return { value: checked.type.value, vc: checked.vc };
	}
	const formed = yield* signature(declared, { openInputs: false, actual: checked.type.value });
	return { value: formed.value, vc: Build.and(checked.vc, formed.vc) };
}

/** An explicit function parameter opens the omitted input predicates of its own signature. */
export function* parameter(term: EB.Term, formation?: Formation): Verification<Formed> {
	const type = yield* NF.evaluate(term);
	const base = yield* NF.bare(type);
	const modal = match(yield* NF.view(type))
		.with(NF.View.Sealed(NF.Patterns.Modal), ({ value }) => value)
		.otherwise(() => undefined);
	const liquid = modal?.modalities.liquid;
	const quantity = modal?.modalities.quantity ?? Q.Many;
	const actual = formation?.actual;
	const marker = yield* Binder.hole(liquid);
	return yield* match(yield* NF.view(base))
		.with(NF.View.Sealed(NF.Patterns.FunctionType), function* () {
			const formed = yield* typeTerm(term, { openInputs: true, actual });
			const callback = yield* NF.bare(formed.value);
			const predicate = marker ? undefined : liquid;
			const value = quantity === Q.Many && !predicate ? callback : NF.Constructors.Modal(callback, { quantity, liquid: predicate });
			return { vc: formed.vc, value };
		})
		.otherwise(function* () {
			const { vc } = yield* check(term, NF.Type);
			if (formation?.openInputs && !liquid) {
				const inherited =
					actual &&
					match(yield* NF.view(actual))
						.with(NF.View.Sealed(NF.Patterns.Modal), ({ value }) => value.modalities.liquid)
						.otherwise(() => undefined);
				const predicate = inherited ?? (yield* Binder.contextual(base, yield* state.ask()));
				return { vc, value: NF.Constructors.Modal(base, { quantity, liquid: predicate }) };
			}

			if (!marker || formation) {
				return { vc, value: type };
			}
			const current = yield* state.ask();
			return yield* match(yield* NF.view(current))
				.with(
					NF.View.Rigid,
					psi => psi.value.variable.lvl < marker.lvl,
					function* () {
						const predicate = yield* Binder.contextual(base, current);
						yield* Metas.registry.modify(registry => Metas.solve(registry, marker.val, predicate));
						return { vc, value: NF.Constructors.Modal(base, { quantity, liquid: predicate }) };
					},
				)
				.otherwise(function* () {
					return { vc, value: type };
				});
		});
}

/** A resolved type alias and a syntactic function type use the same formation rule. */
function* signature(type: NF.Value, formation: Formation): Verification<Formed> {
	return yield* match(yield* NF.view(yield* NF.bare(type)))
		.with(NF.View.Sealed(NF.Patterns.FunctionType), function* () {
			const ctx = yield* reader.ask();
			const term = yield* NF.quote(ctx.env.length, type);
			const checked = yield* check(term, NF.Type, formation);
			assert(checked.value);
			return { vc: checked.vc, value: checked.value };
		})
		.otherwise(function* () {
			return { value: type, vc: Build.true_() };
		});
}

function* typeTerm(term: EB.Term, formation?: Formation): Verification<Formed> {
	const checked = yield* check(term, NF.Type, formation);

	if (checked.value) {
		return { value: checked.value, vc: checked.vc };
	}
	const value = yield* NF.evaluate(term);

	if (!formation) {
		return { value, vc: checked.vc };
	}
	const formed = yield* signature(value, formation);
	return { value: formed.value, vc: Build.and(checked.vc, formed.vc) };
}

type FunctionTerm = EB.Term & { type: "Abs"; binding: Extract<EB.Binding, { type: "Pi" | "Phi" | "Psi" }> };

function* form(term: FunctionTerm, formation?: Formation): Verification<Formed> {
	const ctx = yield* reader.ask();
	const previous = formation?.actual && (yield* NF.view(yield* NF.bare(formation.actual)));
	const fn = match(previous)
		.with(
			NF.View.Sealed(NF.Patterns.FunctionType),
			({ value }) =>
				value.binder.type === term.binding.type && (term.binding.type !== "Pi" || (value.binder.type === "Pi" && value.binder.icit === term.binding.icit)),
			({ value }) => value,
		)
		.otherwise(() => undefined);
	const domain = yield* match(term.binding)
		.with({ type: "Psi" }, function* (psi) {
			const written = psi.requirement && (yield* NF.evaluate(psi.requirement));
			const inherited = fn?.binder.type === "Psi" ? fn.binder.requirement : undefined;
			const requirement = formation?.openInputs ? (written ?? inherited ?? (yield* NF.evaluate(yield* Liquid.Predicate.hole(NF.State)))) : written;
			return { binder: { ...psi, annotation: NF.State, requirement }, vc: Build.true_() };
		})
		.with({ type: "Pi", icit: "Explicit" }, function* (pi) {
			const domain = formation
				? yield* parameter(pi.annotation, { openInputs: formation.openInputs, actual: fn?.binder.annotation })
				: yield* typeTerm(pi.annotation);
			return { binder: { ...pi, annotation: domain.value }, vc: domain.vc };
		})
		.otherwise(function* (binder) {
			const domain = yield* typeTerm(binder.annotation);
			return { binder: { ...binder, annotation: domain.value }, vc: domain.vc };
		});
	const { binder } = domain;
	const annotation = Binder.annotation(binder);
	const name = yield* supply.freshFrom(binder.variable);
	const hint = fn && (yield* NF.apply(fn.binder, fn.closure, NF.Constructors.Rigid(ctx.env.length)));
	const body = yield* scope(name, binder, annotation, typeTerm(term.body, formation && { openInputs: formation.openInputs, actual: hint }));
	const premise = body.vc.tag === "True" ? body.vc : yield* quantify(name, annotation, body.vc);
	return { value: NF.mk({ type: "Abs", binder, closure: yield* NF.closeVal(body.value) }), vc: Build.and(domain.vc, premise) };
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
