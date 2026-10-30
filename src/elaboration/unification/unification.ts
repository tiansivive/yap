import { match, P } from "ts-pattern";
import _ from "lodash";

import * as O from "fp-ts/Option";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "@yap/elaboration/normalization";
import * as Sub from "./substitution";
import { Subst } from "./substitution";

import * as Err from "@yap/elaboration/shared/errors";
import * as R from "@yap/shared/rows";

import * as Row from "@yap/elaboration/unification/rows";

/**
 * Unification's row: the scope, the metacontext read-and-mint (it can register
 * fresh row-tail metas but never solve — solutions ride the subst accumulator
 * until a boundary commits them), the accumulator itself, failure, provenance.
 */
export type Unification<A> = Eff.Eff<
	| Eff.Actions<typeof M.reader>
	| Eff.Only<typeof Metas.registry, "Registry.get" | "Registry.register">
	| Eff.Actions<typeof M.supply>
	| Eff.Actions<typeof Sub.subst>
	| Eff.Actions<typeof M.except>
	| Eff.Actions<typeof M.tracer>,
	A
>;

/**
 * v2's zonked force: forces under a scoped registry overlay composed with the
 * in-flight accumulator, so the machine chains through subst ∘ registry
 * lazily, on demand. The overlay never commits — a failing unification leaves
 * the registry untouched; sound to discard since force's row is Registry.get.
 */
const zonk = function* (value: NF.Value): Unification<NF.Value> {
	const subst = yield* Sub.subst.get();
	const registry = yield* Metas.registry.get();

	const [forced] = yield* Eff.with([Metas.registry.handlers(Metas.withSolutions(registry, subst))], () => NF.force(value));

	return forced;
};

/*
 * Bindings accumulate in the ambient subst state: sequential unifications
 * compose in call order, and later calls read earlier bindings through the
 * accumulator (zonk, the flex guards). Reordering calls reorders composition.
 *
 * The pattern order below is load-bearing — a pair falls through a guard to
 * the next case, and unfolding/resumption is attempted exactly where v2
 * attempted it. Guards probe read-only against frame-entry snapshots.
 */
export const unify = (left: NF.Value, right: NF.Value, lvl: number): Unification<void> =>
	M.tracer.track({ tag: "unify", type: "nf", vals: [left, right], metadata: { action: "unification" } }, function* (): Unification<void> {
		const ctx = yield* M.reader.ask();
		const subst = yield* Sub.subst.get();
		const registry = yield* Metas.registry.get();
		const pure = NF.probe(ctx, registry);

		const [l, r] = [yield* zonk(left), yield* zonk(right)];

		// Force wraps unsolved metas in a Neutral, so we need to unwrap them again.
		yield* match([NF.unwrapNeutral(l), NF.unwrapNeutral(r)])
			.with([NF.Patterns.Flex, NF.Patterns.Flex], function* ([meta1, meta2]) {
				yield* Sub.subst.bind(yield* bind(meta1.variable, meta2));
				const registry = yield* Metas.registry.get();
				const ann1 = Metas.entry(registry, meta1.variable.val).annotation;
				const ann2 = Metas.entry(registry, meta2.variable.val).annotation;
				yield* unify(ann1, ann2, lvl);
			})
			.with(
				[NF.Patterns.Flex, P._],
				([{ variable }]) => !!subst[variable.val],
				function* ([meta, v]) {
					yield* unify(subst[meta.variable.val], v, lvl);
				},
			)
			.with(
				[P._, NF.Patterns.Flex],
				([_l, { variable }]) => !!subst[variable.val],
				function* ([v, meta]) {
					yield* unify(v, subst[meta.variable.val], lvl);
				},
			)
			.with([NF.Patterns.Flex, P._], function* ([meta]) {
				yield* Sub.subst.bind(yield* bind(meta.variable, r));
			})
			.with([P._, NF.Patterns.Flex], function* ([, meta]) {
				yield* Sub.subst.bind(yield* bind(meta.variable, l));
			})
			/*
			 * Glue never reaches the structural clauses below: these only choose which faces to compare.
			 * A meta-headed spine has no unfolding to offer, so it approximates against the folded face and
			 * the meta is solved with the definition rather than its encoding; everything else unfolds.
			 */
			.with([NF.Patterns.Glued, NF.Patterns.Glued], ([a, b]) => same(a, b, lvl))
			.with(
				[NF.Patterns.Glued, NF.Patterns.StuckApp],
				([g, stuck]) => approximable(g, stuck.value),
				([g, stuck]) => unify(g.folded, stuck, lvl),
			)
			.with(
				[NF.Patterns.StuckApp, NF.Patterns.Glued],
				([stuck, g]) => approximable(g, stuck.value),
				([stuck, g]) => unify(stuck, g.folded, lvl),
			)
			.with([NF.Patterns.Glued, P._], ([g, v]) => unify(g.unfolded, v, lvl))
			.with([P._, NF.Patterns.Glued], ([v, g]) => unify(v, g.unfolded, lvl))
			.with([NF.Patterns.Lit, NF.Patterns.Lit], function* ([lit1, lit2]) {
				if (!_.isEqual(lit1.value, lit2.value)) {
					return yield* M.fail(Err.UnificationFailure(lit1, lit2));
				}
			})
			.with([NF.Patterns.Modal, P._], function* ([{ value }, val]) {
				yield* unify(value, val, lvl);
			})
			.with([P._, NF.Patterns.Modal], function* ([val, { value }]) {
				yield* unify(val, value, lvl);
			})
			.with(
				[NF.Patterns.Lambda, NF.Patterns.Lambda],
				([lam1, lam2]) => lam1.binder.icit === lam2.binder.icit,
				function* ([lam1, lam2]) {
					const body1 = yield* NF.apply(lam1.binder, lam1.closure, NF.Constructors.Rigid(lvl));
					const body2 = yield* NF.apply(lam2.binder, lam2.closure, NF.Constructors.Rigid(lvl));
					yield* unify(body1, body2, lvl + 1);
				},
			)
			.with(
				[NF.Patterns.Pi, NF.Patterns.Pi],
				([pi1, pi2]) => pi1.binder.icit === pi2.binder.icit,
				function* ([pi1, pi2]) {
					/* Annotations first: the body unification reads their bindings from the accumulator. */
					yield* unify(pi1.binder.annotation, pi2.binder.annotation, lvl);
					const body1 = yield* NF.apply(pi1.binder, pi1.closure, NF.Constructors.Rigid(lvl));
					const body2 = yield* NF.apply(pi2.binder, pi2.closure, NF.Constructors.Rigid(lvl));
					yield* unify(body1, body2, lvl + 1);
				},
			)
			.with([NF.Patterns.Mu, NF.Patterns.Mu], function* ([mu1, mu2]) {
				yield* unify(mu1.binder.annotation, mu2.binder.annotation, lvl);
				const body1 = yield* NF.apply(mu1.binder, mu1.closure, NF.Constructors.Rigid(lvl));
				const body2 = yield* NF.apply(mu2.binder, mu2.closure, NF.Constructors.Rigid(lvl));
				yield* unify(body1, body2, lvl + 1);
			})
			.with([NF.Patterns.Sigma, NF.Patterns.Sigma], function* ([sig1, sig2]) {
				yield* unify(sig1.binder.annotation, sig2.binder.annotation, lvl);
				const body1 = yield* NF.apply(sig1.binder, sig1.closure, sig1.binder.annotation);
				const body2 = yield* NF.apply(sig2.binder, sig2.closure, sig2.binder.annotation);
				yield* unify(body1, body2, lvl + 1);
			})
			.with([NF.Patterns.SigmaV2, NF.Patterns.SigmaV2], function* ([sig1, sig2]) {
				const body1 = yield* NF.apply(sig1.binder, sig1.closure, NF.Constructors.Rigid(lvl));
				const body2 = yield* NF.apply(sig2.binder, sig2.closure, NF.Constructors.Rigid(lvl));
				yield* unify(body1, body2, lvl + 1);
			})
			.with([P._, NF.Patterns.Mu], function* ([v, mu]) {
				const unfolded = yield* NF.apply(mu.binder, mu.closure, mu);
				yield* M.reader.local(ctx => EB.unfoldMu(ctx, { type: "Mu", variable: mu.binder.variable }, mu), unify(v, unfolded, lvl + 1));
			})
			.with([NF.Patterns.Mu, P._], function* ([mu, v]) {
				const unfolded = yield* NF.apply(mu.binder, mu.closure, mu);
				yield* M.reader.local(ctx => EB.unfoldMu(ctx, { type: "Mu", variable: mu.binder.variable }, mu), unify(unfolded, v, lvl + 1));
			})
			.with([NF.Patterns.Rigid, NF.Patterns.Rigid], function* ([rigid1, rigid2]) {
				if (!_.isEqual(rigid1.variable, rigid2.variable)) {
					return yield* M.fail(Err.RigidVariableMismatch(rigid1, rigid2));
				}
			})
			.with([NF.Patterns.DepLabel, NF.Patterns.DepLabel], [NF.Patterns.NuLabel, NF.Patterns.NuLabel], function* ([l1, l2]) {
				if (l1.variable.name !== l2.variable.name || l1.variable.lvl !== l2.variable.lvl) {
					return yield* M.fail(Err.TypeMismatch(l1, l2));
				}
			})
			.with([NF.Patterns.Schema, NF.Patterns.Sigma], function* ([schema, sig]) {
				const applied = yield* NF.apply(sig.binder, sig.closure, schema.arg);
				yield* unify(schema, applied, lvl);
			})

			.with([NF.Patterns.Sigma, NF.Patterns.Schema], function* ([sig, schema]) {
				const applied = yield* NF.apply(sig.binder, sig.closure, schema.arg);
				yield* unify(applied, schema, lvl);
			})

			/* Inference still produces bare Schemas, so a checked struct type, which is a SigmaV2,
			 * meets one whenever the two are compared. */
			.with([NF.Patterns.Schema, NF.Patterns.SigmaV2], function* ([schema, sig]) {
				const applied = yield* NF.apply(sig.binder, sig.closure, schema.arg);
				yield* unify(schema, applied, lvl);
			})
			.with([NF.Patterns.SigmaV2, NF.Patterns.Schema], function* ([sig, schema]) {
				const applied = yield* NF.apply(sig.binder, sig.closure, schema.arg);
				yield* unify(applied, schema, lvl);
			})
			.with(
				[NF.Patterns.Schema, NF.Patterns.Schema],
				[NF.Patterns.Struct, NF.Patterns.Struct],
				[NF.Patterns.Variant, NF.Patterns.Variant],
				function* ([left, right]) {
					yield* unify(left.arg, right.arg, lvl);
				},
			)
			.with([NF.Patterns.Indexed, NF.Patterns.Indexed], function* ([left, right]) {
				yield* unify(left.func.func.arg, right.func.func.arg, lvl);
				yield* unify(left.func.arg, right.func.arg, lvl);
				yield* unify(left.arg, right.arg, lvl);
			})
			.with([NF.Patterns.Recursive, NF.Patterns.Recursive], function* ([left, right]) {
				yield* unify(left.func, right.func, lvl);
				yield* unify(left.arg, right.arg, lvl);
			})

			/* A stuck projection is a neutral spine, so it unifies as an application does: the labels
			 * must agree and the bases must unify. This happens once a field's type is read off an
			 * abstract record. */
			.with([NF.Patterns.StuckProj, NF.Patterns.StuckProj], function* ([left, right]) {
				if (left.value.label !== right.value.label) {
					return yield* M.fail(Err.TypeMismatch(left, right));
				}
				yield* unify(left.value.base, right.value.base, lvl);
			})

			.with([NF.Patterns.StuckMatch, NF.Patterns.StuckMatch], () => {
				throw new Error("Unification of stuck match expressions is not supported yet");
			})
			.with(
				[NF.Patterns.StuckMatch, P._],
				// eslint-disable-next-line no-restricted-properties -- guard-position probe; the pair falls through when the match cannot resume
				([stuck]) => O.isSome(pure(() => NF.resume(stuck.value))),
				function* ([stuck, value]) {
					const resumed = O.getOrElse<NF.Value>(() => {
						throw new Error("Stuck match must resume after passing its guard");
					})(yield* NF.resume(stuck.value));

					yield* unify(resumed, value, lvl);
				},
			)
			.with(
				[P._, NF.Patterns.StuckMatch],
				// eslint-disable-next-line no-restricted-properties -- guard-position probe; the pair falls through when the match cannot resume
				([, stuck]) => O.isSome(pure(() => NF.resume(stuck.value))),
				function* ([value, stuck]) {
					const resumed = O.getOrElse<NF.Value>(() => {
						throw new Error("Stuck match must resume after passing its guard");
					})(yield* NF.resume(stuck.value));

					yield* unify(value, resumed, lvl);
				},
			)
			.with([NF.Patterns.StuckApp, NF.Patterns.StuckApp], function* ([left, right]) {
				/* Both sides arrive forced, so a residual still blocked here is genuinely stuck. Blocked is outer state; the spine underneath is the structure to compare. */
				yield* unify(left.value, right.value, lvl);
			})
			/* An application residual and an application compare as applications, so the spine decomposition below can solve the residual's head. Ahead of the mu-unfolding fallthroughs, which would otherwise take the pair and discard the spine. */
			.with([NF.Patterns.StuckApp, NF.Patterns.App], function* ([stuck, app]) {
				yield* unify(stuck.value, app, lvl);
			})
			.with([NF.Patterns.App, NF.Patterns.StuckApp], function* ([app, stuck]) {
				yield* unify(app, stuck.value, lvl);
			})
			.with([NF.Patterns.App, NF.Patterns.App], function* ([left, right]) {
				if ([left.func, right.func, left.arg, right.arg].some(NF.isFlex)) {
					yield* unify(left.func, right.func, lvl);
					yield* unify(left.arg, right.arg, lvl);
					return;
				}

				const unfoldedL = yield* NF.unfoldMu(left);
				const unfoldedR = yield* NF.unfoldMu(right);

				if (unfoldedL === undefined && unfoldedR === undefined) {
					yield* unify(left.func, right.func, lvl);
					yield* unify(left.arg, right.arg, lvl);
					return;
				}

				yield* unify(unfoldedL ?? left, unfoldedR ?? right, lvl);
			})

			.with(
				[NF.Patterns.App, P._],
				([app]) => pure(() => NF.unfoldMu(app)) !== undefined,
				function* ([app, v]) {
					const unfolded = yield* NF.unfoldMu(app);

					yield* unify(unfolded ?? app, v, lvl);
				},
			)
			.with(
				[P._, NF.Patterns.App],
				([, app]) => pure(() => NF.unfoldMu(app)) !== undefined,
				function* ([v, app]) {
					const unfolded = yield* NF.unfoldMu(app);

					yield* unify(v, unfolded ?? app, lvl);
				},
			)

			.with([NF.Patterns.Row, NF.Patterns.Row], function* ([{ row: r1 }, { row: r2 }]) {
				yield* Row.unify(r1, r2);
			})
			.with(
				// NOTE: Foreign variables are not strictly α-equivalent, but they get shadowed, so we can assume this is somewhat sound
				// ideally we'll want fully qualified names, but that's not yet implemented
				// SOLUTION: fully qualified names
				[
					{ type: "Var", variable: { type: "Foreign" } },
					{ type: "Var", variable: { type: "Foreign" } },
				],
				([ffi1, ffi2]) => ffi1.variable.name === ffi2.variable.name,
				function* () {
					/* α-equivalent by name; nothing to bind. */
				},
			)
			.otherwise(function* ([badL, badR]) {
				return yield* M.fail(Err.TypeMismatch(badL, badR));
			});
	});

type Glued = NF.Value & { type: "Glued" };

/*
 * Two references to one definition. Unapplied, they are equal by name. Applied, their
 * arguments are compared first, but that comparison may not bind anything: `Const Unit ?a`
 * and `Const Unit Num` agree without `?a = Num`, since a definition need not use every
 * argument. Where it does, the unfolded faces solve the meta anyway.
 */
// TODO: revisit `speculate` and `reference` once the top-level dispatch no longer goes through `unwrapNeutral`.
const same = (a: Glued, b: Glued, lvl: number): Unification<void> =>
	match([a.folded, b.folded])
		.with(
			[NF.Patterns.Free, NF.Patterns.Free],
			([x, y]) => x.variable.name === y.variable.name,
			function* () {},
		)
		.with(
			[NF.Patterns.App, NF.Patterns.App],
			() => reference(a) !== undefined && reference(a) === reference(b),
			function* () {
				const accepted = yield* speculate(a.folded, b.folded, lvl);
				if (!accepted) {
					yield* unify(a.unfolded, b.unfolded, lvl);
				}
			},
		)
		.otherwise(() => unify(a.unfolded, b.unfolded, lvl));

/** The definition a glued value refers to: the name at the head of its folded face. */
const reference = (glued: Glued): string | undefined =>
	match(glued.folded)
		.with(NF.Patterns.Free, ({ variable }) => variable.name)
		.with({ type: "App", func: NF.Patterns.Glued }, ({ func }) => reference(func))
		.otherwise(() => undefined);

/** An applied definition against a spine headed by an unsolved meta. */
const approximable = (glued: Glued, spine: NF.Value): boolean =>
	match(glued.folded)
		.with(NF.Patterns.App, () => NF.isFlex(head(spine)))
		.otherwise(() => false);

const head = (v: NF.Value): NF.Value =>
	match(v)
		.with(NF.Patterns.App, ({ func }) => head(func))
		.otherwise(() => v);

/** Compares under a delimited accumulator seeded with the ambient one; true only if it succeeded and bound nothing new. */
const speculate = function* (left: NF.Value, right: NF.Value, lvl: number): Unification<boolean> {
	const ambient = yield* Sub.subst.get();
	const [outcome, , after] = yield* Eff.with([M.except.handlers(), Sub.subst.handlers(ambient)], () => unify(left, right, lvl));

	return !Eff.failed(outcome) && Object.keys(after).every(key => key in ambient);
};

type Meta = Extract<EB.Variable, { type: "Meta" }>;

/** A single binding for v, occurs-checked; the caller composes it into the accumulator. */
export const bind = function* (v: Meta, ty: NF.Value): Unification<Subst> {
	if (ty.type === "Var" && _.isEqual(ty.variable, v)) {
		return Sub.empty;
	}

	const stuck = match(ty)
		.with(NF.Patterns.StuckMatch, () => true)
		.otherwise(() => false);
	const canonical = stuck ? yield* NF.force(ty) : ty;

	if (yield* occurs(v, canonical)) {
		// solution is a mu type
		throw new Error("Unification: Occurs check failed. Need to implement mu type");
	}

	return Sub.of(v.val, canonical);
};

/** The occurs check: get() once, both walkers close over the snapshot and the needle. */
const occurs = function* (v: Meta, ty: NF.Value): Unification<boolean> {
	const registry = yield* Metas.registry.get();

	const check = (value: NF.Value): boolean =>
		match(value)
			.with(NF.Patterns.Var, ({ variable }) => _.isEqual(variable, v))
			.with({ type: "Neutral" }, ({ value: inner }) => check(inner))
			/* Both faces: a meta can occur in the folded face alone (`Const Unit ?a` unfolds to `Unit`), and that is the face a solution reads back as. */
			.with(NF.Patterns.Glued, ({ folded, unfolded }) => check(folded) || check(unfolded))
			.with(NF.Patterns.Proj, ({ base }) => check(base))
			.with(NF.Patterns.Match, ({ closure, scrutinee }) => check(scrutinee) || inTerm(closure.term))
			.with(NF.Patterns.Inj, ({ base, injected }) => check(base) || check(injected))
			.with(NF.Patterns.Lambda, ({ closure }) => inTerm(closure.term))
			.with(NF.Patterns.Pi, ({ closure }) => inTerm(closure.term))
			.with(NF.Patterns.Sigma, NF.Patterns.SigmaV2, NF.Patterns.Nu, ({ closure }) => inTerm(closure.term))
			.with(NF.Patterns.App, ({ func, arg }) => check(func) || check(arg))
			.with(NF.Patterns.Modal, ({ value: inner, modalities }) => check(inner) || check(modalities.liquid))

			.with(NF.Patterns.Row, ({ row }) =>
				R.fold(
					row,
					(nf, _l, acc) => acc || check(nf),
					rv => rv.type === "Meta" && _.isEqual(rv, v),
					false,
				),
			)
			.otherwise(() => false);

	const inTerm = (tm: EB.Term): boolean =>
		match(tm)
			.with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) => {
				const solved = Metas.solution(registry, variable.val);

				if (solved) {
					return check(solved);
				}

				return _.isEqual(variable, v);
			})
			.with({ type: "Abs" }, ({ binding, body }) => inTerm(binding.annotation) || inTerm(body))
			.with({ type: "App" }, ({ func, arg }) => inTerm(func) || inTerm(arg))
			.with({ type: "Ann" }, ({ term }) => inTerm(term))
			.with({ type: "Match" }, ({ scrutinee, alternatives }) => inTerm(scrutinee) || alternatives.some(({ term }) => inTerm(term)))
			.with({ type: "Block" }, ({ return: ret, statements }) => inTerm(ret) || statements.some(stmt => inTerm(stmt.value)))
			.with({ type: "Row" }, ({ row }) =>
				R.fold(
					row,
					(nf, _l, acc) => acc || inTerm(nf),
					rv => {
						const solved = rv.type === "Meta" ? Metas.solution(registry, rv.val) : undefined;

						if (solved) {
							return check(solved);
						}

						return _.isEqual(rv, v);
					},
					false,
				),
			)
			.with({ type: "Proj" }, ({ term }) => inTerm(term))
			.with({ type: "Inj" }, ({ value, term }) => inTerm(value) || inTerm(term))
			.with({ type: "Lit" }, () => false)
			.with({ type: "Modal" }, ({ term }) => inTerm(term))
			.otherwise(() => false);

	return check(ty);
};
