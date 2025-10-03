import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as A from "fp-ts/Array";

import * as Q from "@yap/shared/modalities/multiplicity";

import * as R from "@yap/shared/rows";

// import * as Modal from "@yap/verification/modalities/shared";

import { match, P } from "ts-pattern";
import { Liquid } from "./modalities";

// export const check = (node: EB.Node): V2.Elaboration<Modal.Artefacts> => {
// 	const r = match([node[0], node[1].nf])
// 		.with([{ type: "Abs" }, { type: "Abs", binder: { type: "Pi" } }], ([tm, ty]) =>
// 			V2.Do(() =>
// 				V2.local(
// 					ctx => EB.bind(ctx, { type: "Lambda", variable: tm.binding.variable }, ty.binder.annotation),
// 					V2.Do(function* () {
// 						const artefacts = yield* check.gen(tm.body);
// 						const [vu] = artefacts.usages;
// 						yield* V2.tell("constraint", { type: "usage", expected: ty.binder.annotation.modalities.quantity, computed: vu });

// 						const implication = Modal.Verification.implication(ty.binder.annotation.modalities.liquid, artefacts.vc);
// 						return { usages: artefacts.usages, vc: implication };
// 					}),
// 				),
// 			),
// 		)
// 		.otherwise(([tm, ty]) =>
// 			V2.Do(function* () {
// 				const artefacts = yield* synth.gen(node);
// 				return {
// 					usages: artefacts.usages,
// 					vc: NF.DSL.Binop.and(artefacts.vc, node[1].modalities.liquid),
// 				};
// 			}),
// 		);

// 	return r;
// };

// check.gen = (node: EB.Node) => V2.pure(check(node));

// export const synth = (node: EB.Node): V2.Elaboration<Modal.Artefacts> => {
// 	const ty = node[1];
// 	const r = match(node[0])
// 		.with({ type: "Var", variable: { type: "Bound" } }, tm =>
// 			V2.Do(function* () {
// 				const zeros = A.replicate<Q.Multiplicity>(tm.variable.index + 1, Q.Zero);
// 				const usages = A.unsafeUpdateAt(tm.variable.index, ty.modalities.quantity, zeros);
// 				return { usages, vc: ty.modalities.liquid } satisfies Modal.Artefacts;
// 			}),
// 		)
// 		.with({ type: "Lit" }, tm =>
// 			V2.Do(function* () {
// 				const ctx = yield* V2.ask();
// 				const nf = yield* NF.evaluate.gen(tm);
// 				// lift the literal to the verification condition. Now, we can use the value to apply refinements (ie, perform substitutions in refinements)
// 				return { usages: Q.noUsage(ctx.env.length), vc: nf } satisfies Modal.Artefacts;
// 			}),
// 		)
// 		.with({ type: "App" }, tm =>
// 			V2.Do(function* () {
// 				const fnArtefacts = yield* synth.gen(tm.func);
// 				const argArtefacts = yield* synth.gen(tm.arg);

// 				const [, fty] = tm.func;
// 				const [, aty] = tm.arg;

// 				return match(fty.nf)
// 					.with({ type: "Abs", binder: { type: "Pi" } }, pi => {
// 						const vc = subtype(
// 							{ nf: aty.nf, refinement: aty.modalities.liquid },
// 							{ nf: pi.binder.annotation.nf, refinement: pi.binder.annotation.modalities.liquid },
// 						);
// 						const usages = Q.add(fnArtefacts.usages, Q.multiply(pi.binder.annotation.modalities.quantity, argArtefacts.usages));
// 						return { usages, vc };
// 					})
// 					.otherwise(() => {
// 						throw new Error("Function type expected");
// 					});
// 			}),
// 		)
// 		.with({ type: "Row" }, tm =>
// 			V2.Do(
// 				R.fold(
// 					tm.row,
// 					(val, lbl, artefacts) =>
// 						function* () {
// 							const { usages, vc } = yield* synth.gen(val);
// 							const accumulated = yield* artefacts();

// 							return { usages: Q.add(accumulated.usages, usages), vc: NF.DSL.Binop.and(accumulated.vc, vc) } satisfies Modal.Artefacts;
// 						},
// 					v => {
// 						if (v.type === "Bound") {
// 							const zeros = A.replicate<Q.Multiplicity>(v.index + 1, Q.Zero);
// 							const usages = A.unsafeUpdateAt(v.index, ty.modalities.quantity, zeros);
// 							return () => V2.lift<Modal.Artefacts>({ usages, vc: Liquid.Constants.tru });
// 						}

// 						if (v.type === "Meta") {
// 							// metavariables are always zero in usage, as they will be substituted by some term later on
// 							// TODO:FIXME: HAve zonker also hold modalities
// 							return () => V2.lift<Modal.Artefacts>({ usages: [Q.Zero], vc: Liquid.Constants.tru });
// 						}

// 						throw new Error("Row variable not implemented yet");
// 					},
// 					() => V2.lift<Modal.Artefacts>({ usages: [Q.Zero], vc: Liquid.Constants.tru }),
// 				),
// 			),
// 		)
// 		.otherwise(() => {
// 			console.warn("synth: Not implemented yet");
// 			return { usages: Q.noUsage(0), vc: Liquid.Constants.tru };
// 		});

// 	return 1 as any;
// };
// synth.gen = (node: EB.Node) => V2.pure(synth(node));

// type LiquidType = { nf: NF.Value; refinement: Modal.Annotations["liquid"] };
// export const subtype = (a: LiquidType, b: LiquidType): Modal.Annotations["liquid"] => {
// 	const s = match([a.nf, b.nf]).with(
// 		[
// 			{ type: "Abs", binder: { type: "Pi" } },
// 			{ type: "Abs", binder: { type: "Pi" } },
// 		],
// 		([at, bt]) =>
// 			V2.Do(function* () {
// 				const vcArg = subtype(
// 					{ nf: bt.binder.annotation.nf, refinement: bt.binder.annotation.modalities.liquid },
// 					{ nf: at.binder.annotation.nf, refinement: at.binder.annotation.modalities.liquid },
// 				); // contravariant position

// 				const ctx = yield* V2.ask();
// 				const anf = NF.apply(at.binder, at.closure, NF.Constructors.Rigid(ctx.env.length), at.binder.annotation.modalities);
// 				const bnf = NF.apply(bt.binder, bt.closure, NF.Constructors.Rigid(ctx.env.length), bt.binder.annotation.modalities);

// 				const vcBody = subtype({ nf: anf, refinement: at.closure.modalitiess.liquid }, { nf: bnf, refinement: bt.closure.modalitiess.liquid });
// 				return Modal.Verification.implication(vcArg, vcBody);
// 			}),
// 	);
// };
