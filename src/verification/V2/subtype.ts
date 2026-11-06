import { match, P } from "ts-pattern";
import { isEqual } from "lodash";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Row from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";

import type { IVL } from "../solver/ivl/types";
import { Build } from "../solver/ivl/build";
import { Liquid } from "../modalities";
import { extractModalities, instantiate, isFirstOrder } from "./utils/refinements";
import { withRowLabels } from "./utils/context";
import { reader, fail, logger, obligations, state, State, supply, type Verification } from "./effects";
import { mkSort, formula, quantify, scope } from "./logic/translate";

export const subtype = function* (left: NF.Value, right: NF.Value): Verification<IVL.Formula> {
	const ctx = yield* reader.ask();
	const registry = yield* Metas.registry.get();
	const display = NF.probe(ctx, registry);

	yield* logger.enter();
	yield* logger.log(
		"Subtyping:",
		EB.Display.Env(ctx.env),
		display(() => NF.display(left, { deBruijn: true })),
		"<:",
		display(() => NF.display(right, { deBruijn: true })),
	);

	const result = yield* dispatch(left, right);

	yield* logger.exit();
	return result;
};

const dispatch = function* (left: NF.Value, right: NF.Value): Verification<IVL.Formula> {
	const ctx = yield* reader.ask();
	const registry = yield* Metas.registry.get();
	const [a, b] = [yield* NF.view(left), yield* NF.view(right)];

	return yield* match([a, b])
		.with([NF.View.Blocked(), P._], ([left, right]) => subtype(left.value, right.value))
		.with([P._, NF.View.Blocked()], ([left, right]) => subtype(left.value, right.value))
		.with([NF.View.Sealed(), P._], ([left, right]) => structural(left.value, right.value))
		.with([P._, NF.View.Sealed()], ([left, right]) => structural(left.value, right.value))
		.with([NF.View.Flex, P._], function* ([flex]) {
			const solution = Metas.solution(registry, flex.value.variable.val);
			if (!solution) {
				throw new Error("Unbound meta variable in subtype");
			}
			return yield* subtype(solution, right);
		})
		.with([P._, NF.View.Flex], function* ([, flex]) {
			const solution = Metas.solution(registry, flex.value.variable.val);
			if (!solution) {
				throw new Error("Unbound meta variable in subtype");
			}
			return yield* subtype(left, solution);
		})
		.with([NF.View.Rigid, NF.View.Rigid], function* ([rigid1, rigid2]) {
			if (rigid1.value.variable.lvl === rigid2.value.variable.lvl) {
				return Build.true_();
			}
			throw new Error("Rigid variables do not match in subtype");
		})
		.with([NF.View.Rigid, P._], function* ([rigid]) {
			const entry = ctx.env[EB.lvl2idx(ctx, rigid.value.variable.lvl)];
			if (!entry) {
				throw new Error("Unbound variable in subtype");
			}
			return yield* subtype(entry.nf, right);
		})
		.with([P._, NF.View.Rigid], function* ([, rigid]) {
			const entry = ctx.env[EB.lvl2idx(ctx, rigid.value.variable.lvl)];
			if (!entry) {
				throw new Error("Unbound variable in subtype");
			}
			return yield* subtype(left, entry.nf);
		})
		.otherwise(() => unsupported(left, right));
};

const unsupported = function* (a: NF.Value, b: NF.Value): Verification<never> {
	const ctx = yield* reader.ask();
	const registry = yield* Metas.registry.get();
	const display = NF.probe(ctx, registry);

	yield* logger.log(
		"Subtype not implemented for",
		display(() => NF.display(a)),
		"<:",
		display(() => NF.display(b)),
	);
	throw new Error(`Subtype not implemented for ${display(() => NF.display(a))} <: ${display(() => NF.display(b))}`);
};

const structural = function* (a: NF.Value, b: NF.Value): Verification<IVL.Formula> {
	const ctx = yield* reader.ask();
	const registry = yield* Metas.registry.get();
	const display = NF.probe(ctx, registry);

	const [left, right] = [NF.unwrapNeutral(a), NF.unwrapNeutral(b)];
	return yield* match([left, right])
		.with([NF.Patterns.Any, P._], function* ([, b]) {
			yield* logger.log(
				"subtype: Any <:",
				display(() => NF.display(b)),
				"— treating as trivially true (stub)",
			);
			return Build.true_();
		})
		.with([P._, NF.Patterns.Any], function* ([a]) {
			yield* logger.log(
				"subtype:",
				display(() => NF.display(a)),
				"<: Any — treating as trivially true (stub)",
			);
			return Build.true_();
		})
		.with([NF.Patterns.Lit, NF.Patterns.Lit], function* ([{ value: v1 }, { value: v2 }]) {
			return isEqual(v1, v2) ? Build.true_() : Build.false_();
		})
		.with([NF.Patterns.Rigid, NF.Patterns.Rigid], function* ([rigid1, rigid2]) {
			if (rigid1.variable.lvl === rigid2.variable.lvl) {
				return Build.true_();
			}
			throw new Error("Rigid variables do not match in subtype");
		})
		.with([NF.Patterns.Row, NF.Patterns.Row], function* ([a, b]) {
			return yield* contains(b.row, a.row);
		})
		.with([NF.Patterns.Indexed, NF.Patterns.Indexed], function* ([a, b]) {
			const domainA = a.func.func.arg;
			const codomainA = a.func.arg;
			const domainB = b.func.func.arg;
			const codomainB = b.func.arg;
			const vcDom = yield* subtype(domainA, domainB);
			const vcCod = yield* subtype(codomainA, codomainB);
			return Build.and(vcDom, vcCod);
		})
		.with([NF.Patterns.Schema, NF.Patterns.HashMap], function* ([schema, hashmap]) {
			const codomain = hashmap.func.arg;
			return yield* Row.fold(
				schema.arg.row,
				function* (val: NF.Value, _lbl: string, acc: Verification<IVL.Formula>): Verification<IVL.Formula> {
					const vc = yield* subtype(val, codomain);
					const unwrapped = yield* acc;
					return Build.and(unwrapped, vc);
				},
				(_: unknown, acc: Verification<IVL.Formula>) => acc,
				(function* () {
					return Build.true_();
				})(),
			);
		})
		.with([NF.Patterns.Sigma, NF.Patterns.Sigma], function* ([a, b]) {
			const vc = yield* subtype(a.binder.annotation, b.binder.annotation);
			const bodyA = yield* NF.apply(a.binder, a.closure, a.binder.annotation);
			const bodyB = yield* NF.apply(b.binder, b.closure, b.binder.annotation);
			const vcBody = yield* subtype(bodyA, bodyB);
			return Build.and(vc, vcBody);
		})
		.with([NF.Patterns.SigmaV2, NF.Patterns.SigmaV2], function* ([a, b]) {
			const lvl = ctx.env.length;
			const witness = NF.Constructors.Rigid(lvl);
			const bodyA = yield* NF.apply(a.binder, a.closure, witness);
			const bodyB = yield* NF.apply(b.binder, b.closure, witness);

			return yield* subtype(bodyA, bodyB);
		})
		.with([NF.Patterns.Schema, NF.Patterns.Sigma], function* ([schema, sig]) {
			const body = yield* NF.apply(sig.binder, sig.closure, NF.Constructors.Row(schema.arg.row));
			return yield* subtype(schema, body);
		})
		.with([NF.Patterns.Sigma, NF.Patterns.Schema], function* ([sig, schema]) {
			const body = yield* NF.apply(sig.binder, sig.closure, NF.Constructors.Row(schema.arg.row));
			return yield* subtype(body, schema);
		})
		.with([NF.Patterns.Schema, NF.Patterns.SigmaV2], function* ([schema, sig]) {
			const body = yield* NF.apply(sig.binder, sig.closure, schema.arg);
			return yield* subtype(schema, body);
		})
		.with([NF.Patterns.SigmaV2, NF.Patterns.Schema], function* ([sig, schema]) {
			const body = yield* NF.apply(sig.binder, sig.closure, schema.arg);
			return yield* subtype(body, schema);
		})
		.with([NF.Patterns.Schema, NF.Patterns.Schema], function* ([{ arg: a }, { arg: b }]) {
			return yield* contains(b.row, a.row);
		})
		.with([NF.Patterns.Variant, NF.Patterns.Variant], function* ([{ arg: a }, { arg: b }]) {
			return yield* contains(b.row, a.row);
		})
		.with([NF.Patterns.Mu, NF.Patterns.Mu], function* ([mu1, mu2]) {
			const arg = yield* subtype(mu1.binder.annotation, mu2.binder.annotation);
			const body1 = yield* NF.apply(mu1.binder, mu1.closure, NF.Constructors.Rigid(ctx.env.length));
			const body2 = yield* NF.apply(mu2.binder, mu2.closure, NF.Constructors.Rigid(ctx.env.length));
			const body = yield* scope(yield* supply.freshFrom(mu2.binder.variable), mu2.binder, mu2.binder.annotation, subtype(body1, body2));
			return Build.and(arg, body);
		})
		.with([NF.Patterns.Recursive, NF.Patterns.Recursive], function* ([left, right]) {
			const vc1 = yield* subtype(left.func, right.func);
			const vc2 = yield* subtype(left.arg, right.arg);
			return Build.and(vc1, vc2);
		})
		/* Both functions are called at the same unknown state, so their refinements are compared there. */
		.with([NF.Patterns.Pi, NF.Patterns.Pi], [NF.Patterns.Lambda, NF.Patterns.Lambda], ([at, bt]) =>
			State.enter(
				(function* () {
					const vcArg = yield* subtype(bt.binder.annotation, at.binder.annotation);
					const lvl = ctx.env.length;
					const anf = yield* NF.apply(at.binder, at.closure, NF.Constructors.Rigid(lvl));
					const bnf = yield* NF.apply(bt.binder, bt.closure, NF.Constructors.Rigid(lvl));
					const name = yield* supply.freshFrom(bt.binder.variable);
					const vcBody = yield* scope(name, bt.binder, bt.binder.annotation, subtype(anf, bnf));

					if (!(yield* isFirstOrder(bt.binder.annotation))) {
						yield* obligations.record("subtype.pi.nonrefinable", vcBody, {
							type: `${display(() => NF.display(at))} <: ${display(() => NF.display(bt))}`,
							description: `Function result must be subtype (non-refinable parameter ${bt.binder.variable})`,
						});
						return Build.and(vcArg, vcBody);
					}

					const sort = yield* mkSort(bt.binder.annotation);
					const modalities = yield* extractModalities(bt.binder.annotation, ctx);
					const applied = yield* instantiate(modalities.liquid, NF.Constructors.Rigid(lvl));
					const phiX = yield* scope(name, bt.binder, bt.binder.annotation, formula(applied));

					const guarded = yield* obligations.record("subtype.pi.body", Build.forall([{ name, sort }], Build.implies(phiX, vcBody)), {
						type: `${display(() => NF.display(at))} <: ${display(() => NF.display(bt))}`,
						description: `Function result must be subtype under parameter ${bt.binder.variable} assumption`,
					});
					yield* obligations.record("subtype.pi.param", vcArg, {
						type: `${display(() => NF.display(bt.binder.annotation))} <: ${display(() => NF.display(at.binder.annotation))}`,
						description: "Function parameter types (contravariant)",
					});
					return Build.and(vcArg, guarded);
				})(),
			),
		)

		.with([{ type: "Existential" }, P._], function* ([sig, ty]) {
			const name = yield* supply.freshFrom(sig.variable);
			const vc = yield* scope(name, { type: "Pi", variable: sig.variable }, sig.annotation, subtype(sig.body.value, ty));
			return yield* quantify(name, sig.annotation, vc);
		})
		.with([P._, { type: "Existential" }], function* ([ty, sig]) {
			const name = yield* supply.freshFrom(sig.variable);
			return yield* scope(name, { type: "Pi", variable: sig.variable }, sig.annotation, subtype(ty, sig.body.value));
		})

		.with([{ type: "Modal" }, { type: "Modal" }], function* ([at, bt]) {
			const baseVc = yield* subtype(at.value, bt.value);

			const lvl = ctx.env.length;
			const appliedAt = yield* instantiate(at.modalities.liquid, NF.Constructors.Rigid(lvl));
			const appliedBt = yield* instantiate(bt.modalities.liquid, NF.Constructors.Rigid(lvl));

			const sort = yield* mkSort(at.value);
			const name = yield* supply.freshFrom(yield* variable(at.modalities.liquid));

			const [phiAt, phiBt] = yield* scope(
				name,
				{ type: "Pi", variable: name },
				at.value,
				(function* (): Verification<[IVL.Formula, IVL.Formula]> {
					return [yield* formula(appliedAt), yield* formula(appliedBt)];
				})(),
			);
			const forall = Build.forall([{ name, sort }], Build.implies(phiAt, phiBt));
			return Build.and(baseVc, forall);
		})
		.with([{ type: "Modal" }, P._], function* ([at, bt]) {
			return yield* subtype(at, NF.Constructors.Modal(bt, { quantity: Q.Zero, liquid: yield* Liquid.Predicate.NeutralNF(bt) }));
		})
		.with([P._, { type: "Modal" }], function* ([at, bt]) {
			return yield* subtype(NF.Constructors.Modal(at, { quantity: Q.Many, liquid: yield* Liquid.Predicate.NeutralNF(at) }), bt);
		})

		.with([NF.Patterns.Mu, P._], function* ([mu, ty]) {
			const unfolded = yield* NF.apply(mu.binder, mu.closure, mu);
			return yield* subtype(unfolded, ty);
		})
		.with([P._, NF.Patterns.Mu], function* ([ty, mu]) {
			const unfolded = yield* NF.apply(mu.binder, mu.closure, mu);
			return yield* subtype(ty, unfolded);
		})
		.with([NF.Patterns.App, NF.Patterns.App], function* ([left, right]) {
			if ([left.func, right.func, left.arg, right.arg].some(NF.isFlex)) {
				const vc1 = yield* subtype(left.func, right.func);
				const vc2 = yield* subtype(left.arg, right.arg);
				return Build.and(vc1, vc2);
			}

			const unfoldedL = yield* NF.unfoldMu(left);
			const unfoldedR = yield* NF.unfoldMu(right);

			if (unfoldedL === undefined && unfoldedR === undefined) {
				const vc1 = yield* subtype(left.func, right.func);
				const vc2 = yield* subtype(left.arg, right.arg);
				return Build.and(vc1, vc2);
			}

			return yield* subtype(unfoldedL ?? left, unfoldedR ?? right);
		})

		.with([NF.Patterns.Flex, P._], function* ([meta, t]) {
			const ty = Metas.solution(registry, meta.variable.val);
			if (!ty) {
				throw new Error("Unbound meta variable in subtype");
			}
			return yield* subtype(ty, t);
		})
		.with([P._, NF.Patterns.Flex], function* ([t, meta]) {
			const ty = Metas.solution(registry, meta.variable.val);
			if (!ty) {
				throw new Error("Unbound meta variable in subtype");
			}
			return yield* subtype(t, ty);
		})

		.with([NF.Patterns.Rigid, P._], function* ([{ variable }, bt]) {
			const entry = ctx.env[EB.lvl2idx(ctx, variable.lvl)];
			if (!entry) {
				throw new Error("Unbound variable in subtype");
			}
			return yield* subtype(entry.nf, bt);
		})
		.with([P._, NF.Patterns.Rigid], function* ([at, { variable }]) {
			const entry = ctx.env[EB.lvl2idx(ctx, variable.lvl)];
			if (!entry) {
				throw new Error("Unbound variable in subtype");
			}
			return yield* subtype(at, entry.nf);
		})

		.with([P._, NF.Patterns.App], function* ([ty, folded]) {
			const unfolded = yield* NF.unfoldMu(folded);
			if (unfolded === undefined) {
				return yield* unsupported(ty, folded);
			}
			return yield* subtype(ty, unfolded);
		})
		.with([NF.Patterns.App, P._], function* ([folded, ty]) {
			const unfolded = yield* NF.unfoldMu(folded);
			if (unfolded === undefined) {
				return yield* unsupported(folded, ty);
			}
			return yield* subtype(unfolded, ty);
		})
		.otherwise(([a, b]) => unsupported(a, b));
};

const contains = function* (a: NF.Row, b: NF.Row): Verification<IVL.Formula> {
	const onVal = function* (v: NF.Value, lbl: string, conj: Verification<IVL.Formula>): Verification<IVL.Formula> {
		const field = Row.lookup(a, lbl);
		if (!field) {
			return yield* fail({ type: "MissingLabel", label: lbl, row: a });
		}
		const accumulated = yield* conj;
		const vc = yield* subtype(v, field);
		return Build.and(accumulated, vc);
	};
	return yield* withRowLabels(
		a,
		withRowLabels(
			b,
			Row.fold(
				b,
				onVal,
				(_rv, acc) => acc,
				(function* () {
					return Build.true_();
				})(),
			),
		),
	);
};

/* The name of a refinement's value binder, so that quantified formulas keep the name the source used. */
const variable = function* (liquid: NF.Value): Verification<string> {
	const predicate = yield* NF.reduce(liquid, yield* state.ask(), "Explicit");
	return yield* match(predicate)
		.with({ type: "Abs" }, function* ({ binder }) {
			return binder.variable;
		})
		.otherwise(() => supply.fresh());
};
