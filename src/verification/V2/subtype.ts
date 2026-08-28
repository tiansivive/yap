import { match, P } from "ts-pattern";
import { isEqual } from "lodash";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Row from "@yap/shared/rows";
import * as E from "fp-ts/Either";
import * as F from "fp-ts/function";
import * as Q from "@yap/shared/modalities/multiplicity";

import type { IVL } from "../solver/ivl/types";
import { Build } from "../solver/ivl/build";
import { Liquid } from "../modalities";
import { extractModalities, isFirstOrder } from "./utils/refinements";
import { noCapture, withRowLabels } from "./utils/context";
import { reader, fail, logger, obligations, type Verification } from "./effects";
import { mkSort, formula, quantify } from "./logic/translate";

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

	const forcedLeft = yield* NF.force(NF.unwrapNeutral(left));
	const forcedRight = yield* NF.force(NF.unwrapNeutral(right));

	const result = yield* match([forcedLeft, forcedRight])
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
		.with([NF.Patterns.Schema, NF.Patterns.HashMap.value], function* ([schema, hashmap]) {
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
		.with([NF.Patterns.Schema, NF.Patterns.Sigma], function* ([schema, sig]) {
			const body = yield* NF.apply(sig.binder, sig.closure, NF.Constructors.Row(schema.arg.row));
			return yield* subtype(schema, body);
		})
		.with([NF.Patterns.Sigma, NF.Patterns.Schema], function* ([sig, schema]) {
			const body = yield* NF.apply(sig.binder, sig.closure, NF.Constructors.Row(schema.arg.row));
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
			const body = yield* reader.local(c => EB.bind(c, mu2.binder, mu2.binder.annotation), subtype(body1, body2));
			return Build.and(arg, body);
		})
		.with([NF.Patterns.Recursive, NF.Patterns.Recursive], function* ([left, right]) {
			const vc1 = yield* subtype(left.func, right.func);
			const vc2 = yield* subtype(left.arg, right.arg);
			return Build.and(vc1, vc2);
		})
		.with([NF.Patterns.Pi, NF.Patterns.Pi], [NF.Patterns.Lambda, NF.Patterns.Lambda], function* ([at, bt]) {
			const vcArg = yield* subtype(bt.binder.annotation, at.binder.annotation);
			const lvl = ctx.env.length;
			const anf = yield* NF.apply(at.binder, at.closure, NF.Constructors.Rigid(lvl));
			const bnf = yield* NF.apply(bt.binder, bt.closure, NF.Constructors.Rigid(lvl));
			const vcBody = yield* reader.local(c => EB.bind(c, bt.binder, bt.binder.annotation), subtype(anf, bnf));

			if (!isFirstOrder(bt.binder.annotation)) {
				yield* obligations.record("subtype.pi.nonrefinable", vcBody, {
					type: `${display(() => NF.display(at))} <: ${display(() => NF.display(bt))}`,
					description: `Function result must be subtype (non-refinable parameter ${bt.binder.variable})`,
				});
				return Build.and(vcArg, vcBody);
			}

			const sort = yield* mkSort(bt.binder.annotation);
			const x = Build.var_(bt.binder.variable, sort);

			const modalities = extractModalities(bt.binder.annotation, ctx);
			if (modalities.liquid.type !== "Abs") {
				throw new Error("Liquid refinement must be a unary function");
			}
			const applied = yield* NF.apply(modalities.liquid.binder, modalities.liquid.closure, NF.Constructors.Rigid(lvl));
			const phiX = yield* formula(applied, { [lvl]: x });

			const guarded = yield* obligations.record("subtype.pi.body", Build.forall([{ name: bt.binder.variable, sort }], Build.implies(phiX, vcBody)), {
				type: `${display(() => NF.display(at))} <: ${display(() => NF.display(bt))}`,
				description: `Function result must be subtype under parameter ${bt.binder.variable} assumption`,
			});
			yield* obligations.record("subtype.pi.param", vcArg, {
				type: `${display(() => NF.display(bt.binder.annotation))} <: ${display(() => NF.display(at.binder.annotation))}`,
				description: "Function parameter types (contravariant)",
			});
			return Build.and(vcArg, guarded);
		})

		.with([{ type: "Existential" }, P._], function* ([sig, ty]) {
			return yield* reader.local(
				c => EB.bind(c, { type: "Pi", variable: sig.variable }, sig.annotation),
				(function* () {
					const vc = yield* subtype(sig.body.value, ty);
					return yield* quantify(sig.variable, sig.annotation, vc);
				})(),
			);
		})
		.with([P._, { type: "Existential" }], function* ([ty, sig]) {
			return yield* reader.local(c => EB.bind(c, { type: "Pi", variable: sig.variable }, sig.annotation), subtype(ty, sig.body.value));
		})

		.with([{ type: "Modal" }, { type: "Modal" }], function* ([at, bt]) {
			const baseVc = yield* subtype(at.value, bt.value);

			const pAt = at.modalities.liquid;
			const pBt = bt.modalities.liquid;
			if (pAt.type !== "Abs" || pBt.type !== "Abs") {
				throw new Error("Liquid refinements must be unary functions");
			}

			const lvl = ctx.env.length;
			const appliedAt = yield* NF.apply(pAt.binder, pAt.closure, NF.Constructors.Rigid(lvl));
			const appliedBt = yield* NF.apply(pBt.binder, pBt.closure, NF.Constructors.Rigid(lvl));

			const sort = yield* mkSort(at.value);
			const x = Build.var_(pAt.binder.variable, sort);

			const rigids = { [lvl]: x } as Record<number, IVL.Term>;
			const phiAt = yield* formula(appliedAt, rigids);
			const phiBt = yield* formula(appliedBt, rigids);
			const forall = Build.forall([{ name: pAt.binder.variable, sort }], Build.implies(phiAt, phiBt));
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
			const isFlex = (t: NF.Value) =>
				match(NF.unwrapNeutral(t))
					.with(NF.Patterns.Flex, () => true)
					.otherwise(() => false);
			if ([left.func, right.func, left.arg, right.arg].some(isFlex)) {
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
				yield* logger.log(
					"Subtype not implemented for",
					display(() => NF.display(ty)),
					"<:",
					display(() => NF.display(folded)),
				);
				throw new Error(`Subtype not implemented for ${display(() => NF.display(ty))} <: ${display(() => NF.display(folded))}`);
			}
			return yield* subtype(ty, unfolded);
		})
		.with([NF.Patterns.App, P._], function* ([folded, ty]) {
			const unfolded = yield* NF.unfoldMu(folded);
			if (unfolded === undefined) {
				yield* logger.log(
					"Subtype not implemented for",
					display(() => NF.display(folded)),
					"<:",
					display(() => NF.display(ty)),
				);
				throw new Error(`Subtype not implemented for ${display(() => NF.display(folded))} <: ${display(() => NF.display(ty))}`);
			}
			return yield* subtype(unfolded, ty);
		})

		.otherwise(function* ([a, b]) {
			yield* logger.log(
				"Subtype not implemented for",
				display(() => NF.display(a)),
				"<:",
				display(() => NF.display(b)),
			);
			throw new Error(`Subtype not implemented for ${display(() => NF.display(a))} <: ${display(() => NF.display(b))}`);
		});

	yield* logger.exit();
	return result;
};

const contains = function* (a: NF.Row, b: NF.Row): Verification<IVL.Formula> {
	const onVal = function* (v: NF.Value, lbl: string, conj: Verification<IVL.Formula>): Verification<IVL.Formula> {
		const rewritten = Row.rewrite(a, lbl, () => E.left({ tag: "Other", message: `Label ${lbl} not found` }));
		return yield* F.pipe(
			rewritten,
			E.fold(
				() => fail({ type: "MissingLabel", label: lbl, row: a }),
				function* (rewriteResult) {
					if (rewriteResult.type !== "extension") {
						throw new Error("Row rewrite should yield extension");
					}
					const accumulated = yield* conj;
					const vc = yield* subtype(v, rewriteResult.value);
					return Build.and(accumulated, vc);
				},
			),
		);
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
