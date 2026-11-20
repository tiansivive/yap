import { isMatching, match, P } from "ts-pattern";
import { isEqual } from "lodash";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Row from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";

import type { IVL } from "../solver/ivl/types";
import { Build } from "../solver/ivl/build";
import { Liquid } from "../modalities";
import { noCapture, withRowLabels } from "./utils/context";
import { reader, fail, logger, supply, type Verification } from "./effects";
import * as Binder from "./binders";
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
	const [a, b] = [yield* subtypeOperand(left), yield* subtypeOperand(right)];

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

/** Subtyping compares the application contract of a function-valued parameter. */
function* subtypeOperand(type: NF.Value): Verification<NF.View> {
	const viewed = yield* NF.view(type);
	return yield* match(viewed)
		.with(NF.View.Sealed(NF.Patterns.Modal), function* ({ value: modal }) {
			const bare = yield* NF.view(yield* NF.bare(type));
			return yield* match(bare)
				.with(NF.View.Sealed(NF.Patterns.FunctionType), function* () {
					return !modal.modalities.liquid || (yield* Binder.hole(modal.modalities.liquid)) ? bare : viewed;
				})
				.otherwise(function* () {
					return viewed;
				});
		})
		.otherwise(function* () {
			return viewed;
		});
}

type Comparison = { left: NF.Value; right: NF.Value; vc: IVL.Formula };
type FunctionValue = NF.Value & { type: "Abs" };

/** The right side of subsumption is the type exposed by an ascription. */
export function* subsume(left: NF.Value, right: NF.Value): Verification<Comparison> {
	const a = yield* subtypeOperand(left);
	const b = yield* subtypeOperand(right);
	const result = yield* match([a, b])
		.with([NF.View.Sealed(NF.Patterns.Pi), NF.View.Sealed(NF.Patterns.Pi)], function* ([{ value: a }, { value: b }]) {
			if (a.binder.icit !== b.binder.icit) {
				return { left, right, vc: Build.false_() };
			}
			const domain =
				a.binder.icit === "Explicit" ? yield* callback(b.binder.annotation, a.binder.annotation) : yield* compare(b.binder.annotation, a.binder.annotation);
			return yield* compareDomains(a, b, domain, subsume);
		})
		.with([NF.View.Sealed(NF.Patterns.Psi), NF.View.Sealed(NF.Patterns.Psi)], function* ([{ value: a }, { value: b }]) {
			const required = stateDomain(b.binder.requirement);
			const accepted = stateDomain(a.binder.requirement);
			const body = yield* compareBodies(a, b, required, subsume);
			return { ...body, vc: Build.and(yield* subtype(required, accepted), body.vc) };
		})
		.with(
			[NF.View.Sealed(NF.Patterns.Phi), NF.View.Sealed(NF.Patterns.Phi)],
			[NF.View.Sealed(NF.Patterns.Lambda), NF.View.Sealed(NF.Patterns.Lambda)],
			function* ([{ value: a }, { value: b }]) {
				return yield* compareDomains(a, b, yield* compare(b.binder.annotation, a.binder.annotation), subsume);
			},
		)
		.otherwise(() => compare(left, right));
	return yield* restoreModalities(left, right, result);
}

/** A callback's silent preconditions inherit the established predicates at corresponding binders. */
function* callback(left: NF.Value, right: NF.Value): Verification<Comparison> {
	const a = yield* subtypeOperand(left);
	const b = yield* subtypeOperand(right);
	const result = yield* match([a, b])
		.with([NF.View.Sealed(NF.Patterns.Psi), NF.View.Sealed(NF.Patterns.Psi)], function* ([{ value: a }, { value: b }]) {
			const provided = a.binder.requirement ?? b.binder.requirement;
			const required = b.binder.requirement ?? a.binder.requirement;
			const domain = stateDomain(required);
			const vc = provided === required ? Build.true_() : yield* subtype(domain, stateDomain(provided));
			const body = yield* compareBodies(
				{ ...a, binder: { ...a.binder, requirement: provided } },
				{ ...b, binder: { ...b.binder, requirement: required } },
				domain,
				callback,
			);
			return { ...body, vc: Build.and(vc, body.vc) };
		})
		.with([NF.View.Sealed(NF.Patterns.Pi), NF.View.Sealed(NF.Patterns.Pi)], function* ([{ value: a }, { value: b }]) {
			if (a.binder.icit !== b.binder.icit) {
				return { left, right, vc: Build.false_() };
			}
			const domain =
				a.binder.icit === "Explicit" ? yield* compareInput(b.binder.annotation, a.binder.annotation) : yield* compare(b.binder.annotation, a.binder.annotation);
			return yield* compareDomains(a, b, domain, callback);
		})
		.with([NF.View.Sealed(NF.Patterns.Phi), NF.View.Sealed(NF.Patterns.Phi)], function* ([{ value: a }, { value: b }]) {
			return yield* compareDomains(a, b, yield* compare(b.binder.annotation, a.binder.annotation), callback);
		})
		.otherwise(() => compare(left, right));
	return yield* restoreModalities(left, right, result);
}

function* compareInput(left: NF.Value, right: NF.Value): Verification<Comparison> {
	if (isMatching(NF.View.Sealed(NF.Patterns.FunctionType), yield* subtypeOperand(left))) {
		return yield* callback(left, right);
	}
	const a = yield* NF.view(left);
	const b = yield* NF.view(right);
	const la = isMatching(NF.View.Sealed(NF.Patterns.Modal), a) ? a.value.modalities : undefined;
	const lb = isMatching(NF.View.Sealed(NF.Patterns.Modal), b) ? b.value.modalities : undefined;

	if (Boolean(la?.liquid) === Boolean(lb?.liquid)) {
		return yield* compare(left, right);
	}
	const lbase = yield* NF.bare(left);
	const rbase = yield* NF.bare(right);
	return {
		left: la?.liquid ? left : NF.Constructors.Modal(lbase, { quantity: la?.quantity ?? Q.Many, liquid: lb?.liquid }),
		right: lb?.liquid ? right : NF.Constructors.Modal(rbase, { quantity: lb?.quantity ?? Q.Many, liquid: la?.liquid }),
		vc: yield* subtype(lbase, rbase),
	};
}

function* compare(left: NF.Value, right: NF.Value): Verification<Comparison> {
	return { left, right, vc: yield* subtype(left, right) };
}

function* compareDomains(a: FunctionValue, b: FunctionValue, domain: Comparison, compare: typeof subsume): Verification<Comparison> {
	const left = { ...a, binder: { ...a.binder, annotation: domain.right } };
	const right = { ...b, binder: { ...b.binder, annotation: domain.left } };
	const body = yield* compareBodies(left, right, domain.left, compare);
	return { ...body, vc: Build.and(domain.vc, body.vc) };
}

function* compareBodies(a: FunctionValue, b: FunctionValue, domain: NF.Value, compare: typeof subsume): Verification<Comparison> {
	const variable = NF.Constructors.Rigid((yield* reader.ask()).env.length);
	const left = yield* NF.apply(a.binder, a.closure, variable);
	const right = yield* NF.apply(b.binder, b.closure, variable);
	const name = yield* supply.freshFrom(b.binder.variable);
	const body = yield* scope(name, b.binder, domain, compare(left, right));
	return {
		left: NF.mk({ type: "Abs", binder: a.binder, closure: yield* NF.closeVal(body.left) }),
		right: NF.mk({ type: "Abs", binder: b.binder, closure: yield* NF.closeVal(body.right) }),
		vc: body.vc.tag === "True" ? body.vc : yield* quantify(name, domain, body.vc),
	};
}

const stateDomain = (requirement?: NF.Value) => (requirement ? NF.Constructors.Modal(NF.State, { quantity: Q.Many, liquid: requirement }) : NF.State);

function* restoreModalities(left: NF.Value, right: NF.Value, compared: Comparison): Verification<Comparison> {
	function* wrap(original: NF.Value, value: NF.Value) {
		if (value === original) {
			return value;
		}
		const viewed = yield* NF.view(original);

		if (!isMatching(NF.View.Sealed(NF.Patterns.Modal), viewed)) {
			return value;
		}
		const { quantity, liquid } = viewed.value.modalities;
		const predicate = (yield* Binder.hole(liquid)) ? undefined : liquid;
		return quantity === Q.Many && !predicate ? value : NF.Constructors.Modal(value, { quantity, liquid: predicate });
	}
	return { left: yield* wrap(left, compared.left), right: yield* wrap(right, compared.right), vc: compared.vc };
}

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
		.with(
			[NF.Patterns.Psi, NF.Patterns.Psi],
			[NF.Patterns.Pi, NF.Patterns.Pi],
			[NF.Patterns.Phi, NF.Patterns.Phi],
			[NF.Patterns.Lambda, NF.Patterns.Lambda],
			function* ([a, b]) {
				return (yield* subsume(a, b)).vc;
			},
		)
		.with([{ type: "Existential" }, P._], function* ([sig, ty]) {
			const name = yield* supply.freshFrom(sig.variable);
			const vc = yield* scope(name, { type: "Pi", variable: sig.variable }, sig.annotation, subtype(sig.body.value, ty));
			return yield* quantify(name, sig.annotation, vc);
		})
		.with([P._, { type: "Existential" }], function* ([ty, sig]) {
			return yield* scope(yield* supply.freshFrom(sig.variable), { type: "Pi", variable: sig.variable }, sig.annotation, subtype(ty, sig.body.value));
		})

		.with([{ type: "Modal" }, { type: "Modal" }], function* ([at, bt]) {
			const baseVc = yield* subtype(at.value, bt.value);

			const pAt = at.modalities.liquid ?? Liquid.Predicate.NeutralNF(at.value, ctx);
			const pBt = bt.modalities.liquid ?? Liquid.Predicate.NeutralNF(bt.value, ctx);
			const value = NF.Constructors.Rigid(ctx.env.length);

			const sort = yield* mkSort(at.value);
			const name = yield* supply.freshFrom("v");
			const [phiAt, phiBt] = yield* scope(
				name,
				{ type: "Pi", variable: name },
				at.value,
				(function* (): Verification<[IVL.Formula, IVL.Formula]> {
					const appliedAt = yield* NF.reduce(pAt, value, "Explicit");
					const appliedBt = yield* NF.reduce(pBt, value, "Explicit");
					return [yield* formula(appliedAt), yield* formula(appliedBt)];
				})(),
			);
			const forall = Build.forall([{ name, sort }], Build.implies(phiAt, phiBt));
			return Build.and(baseVc, forall);
		})
		.with([{ type: "Modal" }, P._], function* ([at, bt]) {
			return yield* subtype(at, NF.Constructors.Modal(bt, { quantity: Q.Zero, liquid: Liquid.Predicate.NeutralNF(bt, noCapture(ctx)) }));
		})
		.with([P._, { type: "Modal" }], function* ([at, bt]) {
			return yield* subtype(NF.Constructors.Modal(at, { quantity: Q.Many, liquid: Liquid.Predicate.NeutralNF(at, noCapture(ctx)) }), bt);
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
