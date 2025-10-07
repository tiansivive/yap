import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as A from "fp-ts/Array";

import * as Q from "@yap/shared/modalities/multiplicity";

import * as R from "@yap/shared/rows";

import * as Modal from "@yap/verification/modalities/shared";

import { match, P } from "ts-pattern";
import { Liquid } from "./modalities";
import { isEqual } from "lodash";

export const check = (tm: EB.Term, ty: NF.Value): V2.Elaboration<Modal.Artefacts> => {
	const r = match([tm, ty])
		.with([{ type: "Abs" }, { type: "Abs", binder: { type: "Pi" } }], ([tm, ty]) =>
			V2.Do(() =>
				V2.local(
					ctx => EB.bind(ctx, { type: "Lambda", variable: tm.binding.variable }, ty.binder.annotation),
					V2.Do(function* () {
						const ctx = yield* V2.ask();

						const artefacts = yield* V2.local(
							ctx => EB.bind(ctx, { type: "Pi", variable: tm.binding.variable }, ty.binder.annotation),
							(() => {
								const tyBody = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));
								return check(tm.body, tyBody);
							})(),
						);

						const modalities: Modal.Annotations = extract(ty.binder.annotation);

						const [vu, ...usages] = artefacts.usages;
						yield* V2.tell("constraint", { type: "usage", expected: modalities.quantity, computed: vu });

						const vc = NF.evaluate(ctx, modalities.liquid);

						// const app = EB.Constructors.App("Explicit", EB.Constructors.Var({ type: "Bound", index: 0 }), modalities.liquid);
						// const imply = NF.Constructors.Lambda("r", "Explicit", NF.Constructors.Closure(ctx, app), );

						// const implication = Modal.Verification.implication(modalities.liquid, artefacts.vc);

						const implication = Modal.Verification.imply(ctx, ty.binder.annotation, modalities.liquid, artefacts.vc);
						return { usages, vc: implication };
					}),
				),
			),
		)
		.otherwise(([tm, ty]) =>
			V2.Do(function* () {
				const [synthed, artefacts] = yield* synth.gen(tm);
				// Since verification runs after typechecking, we can assume that the term has at least the type we are checking against
				// Therefore, we can lift it to have the type we are checking against, with the added synthed liquid refinement
				// We Many as a dummy quantity, since it has no effect on subtyping
				// const synthed = NF.Constructors.Modal(ty, { quantity: Q.Many, liquid: artefacts.vc });
				const vc = yield* subtype.gen(synthed, ty);
				return { usages: artefacts.usages, vc };
			}),
		);

	// return r;
	return r;
};

check.gen = (tm: EB.Term, ty: NF.Value) => V2.pure(check(tm, ty));

type Synthed = [NF.Value, Modal.Artefacts];
export const synth = (term: EB.Term): V2.Elaboration<Synthed> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();

		const r = match(term)
			.with({ type: "Var", variable: { type: "Bound" } }, tm =>
				V2.Do(function* () {
					const lvl = ctx.env.length - 1 - tm.variable.index;
					const entry = ctx.env[lvl];

					if (!entry) {
						throw new Error("Unbound variable in synth");
					}

					const [binder, , ty] = entry.type;

					const modalities = extract(ty);
					const zeros = A.replicate<Q.Multiplicity>(ctx.env.length, Q.Zero);
					const usages = A.unsafeUpdateAt(lvl, modalities.quantity, zeros);

					//const vc =
					return [entry.nf, { usages, vc: NF.evaluate(ctx, modalities.liquid) }] satisfies Synthed; // TODO: probably need to strengthen the refinement with the literal here
				}),
			)
			.with({ type: "Var" }, tm => {
				console.warn("synth: Other variable types not implemented yet");
				return V2.of<Synthed>([NF.Any, { usages: Q.noUsage(ctx.env.length), vc: Liquid.Constants.tru() }]);
			})
			.with({ type: "Lit" }, tm =>
				V2.Do(function* () {
					// const nf = NF.evaluate(ctx, tm);
					// Also need to selfify here
					const nf = match(tm.value)
						.with({ type: "Atom" }, l => NF.Constructors.Lit(l))
						.with({ type: "Num" }, l => NF.Constructors.Lit({ type: "Atom", value: "Num" }))
						.with({ type: "String" }, l => NF.Constructors.Lit({ type: "Atom", value: "String" }))
						.with({ type: "Bool" }, l => NF.Constructors.Lit({ type: "Atom", value: "Bool" }))
						.with({ type: "unit" }, l => NF.Constructors.Lit({ type: "Atom", value: "Unit" }))
						.exhaustive();
					return [nf, { usages: Q.noUsage(ctx.env.length), vc: Liquid.Constants.tru() }] satisfies Synthed;
				}),
			)
			.with({ type: "Abs" }, tm =>
				V2.Do(function* () {
					// const modalities = extract(tm.binding.annotation);

					const [, bArtefacts] = yield* V2.local(_ctx => EB.bind(_ctx, { type: "Pi", variable: tm.binding.variable }, tm.binding.annotation), synth(tm.body));

					//const vc = Modal.Verification.implication(NF.evaluate(ctx, modalities.liquid), bArtefacts.vc)

					const icit = tm.binding.type === "Lambda" || tm.binding.type === "Pi" ? tm.binding.icit : "Explicit";
					const type = NF.Constructors.Pi(tm.binding.variable, icit, tm.binding.annotation, NF.Constructors.Closure(ctx, tm.body));

					// Note: trying to prevent lambdas from having refinements
					return [type, { usages: bArtefacts.usages, vc: Liquid.Constants.tru() }] satisfies Synthed;
				}),
			)
			.with({ type: "App" }, tm =>
				V2.Do(function* () {
					const fn = yield* synth.gen(tm.func);
					const [fnTy, fnArtefacts] = fn;

					const [out, usages, vc] = yield* V2.pure(
						match(fnTy)
							.with({ type: "Abs", binder: { type: "Pi" } }, ty =>
								V2.Do(function* () {
									const checked = yield* check.gen(tm.arg, ty.binder.annotation);
									const modalities = extract(ty);
									const us = Q.add(fnArtefacts.usages, Q.multiply(modalities.quantity, checked.usages));

									const applied = NF.reduce(checked.vc, NF.evaluate(ctx, tm.arg), "Explicit");
									const vc = NF.DSL.Binop.and(fnArtefacts.vc, applied);
									return [NF.apply(ty.binder, ty.closure, ty.binder.annotation), us, vc] as const;
								}),
							)
							.otherwise(() => {
								throw new Error("Impossible: Function type expected in application");
							}),
					);

					return [out, { usages, vc }] satisfies Synthed;
				}),
			)
			// .with({ type: "Row" }, tm =>
			//     V2.Do(
			//         R.fold(
			//             tm.row,
			//             (val, lbl, artefacts) =>
			//                 function* () {
			//                     const { usages, vc } = yield* synth.gen(val);
			//                     const accumulated = yield* artefacts();

			//                     return { usages: Q.add(accumulated.usages, usages), vc: NF.DSL.Binop.and(accumulated.vc, vc) } satisfies Modal.Artefacts;
			//                 },
			//             v => {
			//                 if (v.type === "Bound") {
			//                     const zeros = A.replicate<Q.Multiplicity>(v.index + 1, Q.Zero);
			//                     const usages = A.unsafeUpdateAt(v.index, ty.modalities.quantity, zeros);
			//                     return () => V2.lift<Modal.Artefacts>({ usages, vc: Liquid.Constants.tru });
			//                 }

			//                 if (v.type === "Meta") {
			//                     // metavariables are always zero in usage, as they will be substituted by some term later on
			//                     // TODO:FIXME: HAve zonker also hold modalities
			//                     return () => V2.lift<Modal.Artefacts>({ usages: [Q.Zero], vc: Liquid.Constants.tru });
			//                 }

			//                 throw new Error("Row variable not implemented yet");
			//             },
			//             () => V2.lift<Modal.Artefacts>({ usages: [Q.Zero], vc: Liquid.Constants.tru }),
			//         ),
			//     ),
			// )
			.otherwise(() => {
				console.warn("synth: Not implemented yet");
				return V2.of<Synthed>([NF.Any, { usages: Q.noUsage(0), vc: Liquid.Constants.tru() }]);
			});
		const ret = yield* V2.pure(r);
		return ret;
	});
synth.gen = (tm: EB.Term) => V2.pure(synth(tm));

const extract = (nf: NF.Value) =>
	match(nf)
		.with({ type: "Modal" }, m => m.modalities)
		.otherwise(() => ({ quantity: Q.Many, liquid: Liquid.Predicate.Neutral(nf) }));

export const subtype = (a: NF.Value, b: NF.Value): V2.Elaboration<Modal.Artefacts["vc"]> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const s = match([NF.unwrapNeutral(a), NF.unwrapNeutral(b)])
			.with([NF.Patterns.Flex, P._], ([meta, t]) => {
				const ty = ctx.zonker[meta.variable.val];

				if (!ty) {
					throw new Error("Unbound meta variable in subtype");
				}

				return subtype(ty, t);
			})
			.with([P._, NF.Patterns.Flex], ([t, meta]) => {
				const ty = ctx.zonker[meta.variable.val];

				if (!ty) {
					throw new Error("Unbound meta variable in subtype");
				}

				return subtype(t, ty);
			})
			.with(
				[NF.Patterns.Rigid, P._],
				([rigid, t]) => t.type !== "Var" || t.variable.type !== "Bound" || rigid.variable.lvl !== t.variable.lvl,
				([{ variable }, bt]) =>
					V2.Do(function* () {
						const ty = ctx.env[variable.lvl];

						if (!ty) {
							throw new Error("Unbound variable in subtype");
						}

						return yield* subtype.gen(ty.nf, bt);
					}),
			)
			.with(
				[P._, NF.Patterns.Rigid],
				([at, { variable }]) => at.type !== "Var" || at.variable.type !== "Bound" || variable.lvl !== at.variable.lvl,
				([at, { variable }]) =>
					V2.Do(function* () {
						const ty = ctx.env[variable.lvl];

						if (!ty) {
							throw new Error("Unbound variable in subtype");
						}

						return yield* subtype.gen(at, ty.nf);
					}),
			)
			.with([{ type: "Modal" }, { type: "Modal" }], ([at, bt]) => {
				// const ar = NF.evaluate(ctx, at.modalities.liquid);
				// const br = NF.evaluate(ctx, bt.modalities.liquid);

				const p1 = EB.Constructors.App("Explicit", at.modalities.liquid, EB.Constructors.Var({ type: "Bound", index: 0 }));
				const p2 = EB.Constructors.App("Explicit", bt.modalities.liquid, EB.Constructors.Var({ type: "Bound", index: 0 }));

				// const implication = EB.DSL.or(p1, EB.DSL.not(p2));
				const implication = EB.DSL.and(p1, p2);

				const r = EB.Constructors.Lambda("x", "Explicit", implication, at.value);

				return V2.of(NF.evaluate(ctx, r));
			})
			.with([{ type: "Modal" }, P._], ([at, bt]) => subtype(at, NF.Constructors.Modal(bt, { quantity: Q.Zero, liquid: Liquid.Predicate.Neutral(bt) })))
			.with([P._, { type: "Modal" }], ([at, bt]) => subtype(NF.Constructors.Modal(at, { quantity: Q.Many, liquid: Liquid.Predicate.Neutral(at) }), bt))

			.with(
				[
					{ type: "Abs", binder: { type: "Pi" } },
					{ type: "Abs", binder: { type: "Pi" } },
				],
				([at, bt]) =>
					V2.Do(function* () {
						const vcArg = yield* subtype.gen(bt.binder.annotation, at.binder.annotation); // contravariant position

						const ctx = yield* V2.ask();
						const anf = NF.apply(at.binder, at.closure, NF.Constructors.Rigid(ctx.env.length));
						const bnf = NF.apply(bt.binder, bt.closure, NF.Constructors.Rigid(ctx.env.length));

						const vcBody = yield* subtype.gen(anf, bnf); // covariant position
						return Modal.Verification.implication(vcArg, vcBody);
					}),
			)
			.with([NF.Patterns.Lit, NF.Patterns.Lit], ([{ value: v1 }, { value: v2 }]) => {
				return isEqual(v1, v2) ? V2.of(Liquid.Constants.tru()) : V2.of(Liquid.Constants.fls());
			})
			.otherwise(([a, b]) =>
				V2.Do(function* () {
					const ctx = yield* V2.ask();
					console.warn("Subtype not fully implemented yet");
					console.log("A:", NF.display(a, ctx.zonker, ctx.metas));
					console.log(a);
					console.log("B:", NF.display(b, ctx.zonker, ctx.metas));
					console.log(b);
					console.log(ctx.zonker);
					return Liquid.Constants.fls();
				}),
			);

		// return s as Modal.Annotations["liquid"];
		const r = yield* V2.pure(s);
		return r;
	});
subtype.gen = (a: NF.Value, b: NF.Value) => V2.pure(subtype(a, b));
