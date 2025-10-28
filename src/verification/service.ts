import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as A from "fp-ts/Array";
import * as E from "fp-ts/Either";
import * as F from "fp-ts/function";

import * as Q from "@yap/shared/modalities/multiplicity";

import * as Modal from "@yap/verification/modalities/shared";
import * as Row from "@yap/shared/rows";

import { match, P } from "ts-pattern";
import { Liquid } from "./modalities";
import { isEqual } from "lodash";

import { Sort, Context, Expr, IntNum, Bool, SMTArray } from "z3-solver";
import {
	OP_ADD,
	OP_AND,
	OP_DIV,
	OP_EQ,
	OP_GT,
	OP_GTE,
	OP_LT,
	OP_LTE,
	OP_MUL,
	OP_NEQ,
	OP_NOT,
	OP_OR,
	OP_SUB,
	operatorMap,
	PrimOps,
} from "@yap/shared/lib/primitives";
import { S } from "vitest/dist/chunks/config.DCnyCTbs";

export const VerificationService = (Z3: Context<"main">) => {
	const Sorts = {
		Int: Z3.Int.sort(),
		Num: Z3.Real.sort(),
		Bool: Z3.Bool.sort(),
		String: Z3.Sort.declare("String"),
		Unit: Z3.Sort.declare("Unit"),
		Row: Z3.Sort.declare("Row"),
		Atom: Z3.Sort.declare("Atom"),
		Type: Z3.Sort.declare("Type"),

		stringify: (sm: SortMap): string =>
			match(sm)
				.with({ Prim: P.select() }, p => p.name.toString())
				.with({ App: P.select() }, App => {
					const [f, a] = App;
					const fs = Sorts.stringify(f);
					const as = Sorts.stringify(a);
					return `App(${fs}, ${as})` as any;
				})
				.with({ Func: P.select() }, Func => {
					const [a, body] = Func;
					const as = Sorts.stringify(a);
					const bs = Sorts.stringify(body);
					return `(${as} -> ${bs})` as any;
				})
				.exhaustive(),
	};

	// TODO: simplify this algorithm and make it more understandable
	const bumpAlpha = (s: string): string => {
		// assumes s is non-empty and only contains [a-z]
		let carry = 1;
		let res = "";
		for (let i = s.length - 1; i >= 0; i--) {
			const v = s.charCodeAt(i) - 97 + carry; // 'a' -> 0
			if (v >= 26) {
				res = "a" + res;
				carry = 1;
			} else {
				res = String.fromCharCode(97 + v) + res;
				carry = 0;
			}
		}

		if (carry) {
			res = "a" + res;
		}
		return res;
	};

	let freshSeq = "a";
	const freshName = () => {
		const name = `$${freshSeq}`;
		freshSeq = bumpAlpha(freshSeq);
		return name;
	};

	const check = (tm: EB.Term, ty: NF.Value): V2.Elaboration<Modal.Artefacts> =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			// console.log(`Checking: ${EB.Display.Term(tm, ctx)}\nAgainst: ${NF.display(ty, ctx)}`);
			const r = match([tm, NF.force(ctx, ty)])
				.with([{ type: "Modal" }, NF.Patterns.Type], ([tm, ty]) => check.gen(tm.term, ty))
				.with(
					[
						{ type: "Abs", binder: { type: "Lambda" } },
						{ type: "Abs", binder: { type: "Pi" } },
					],
					([tm, ty]) =>
						V2.local(
							ctx => EB.bind(ctx, { type: "Lambda", variable: tm.binding.variable }, ty.binder.annotation),
							V2.Do(function* () {
								const tyBody = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));
								const artefacts = yield* check.gen(tm.body, tyBody);

								const modalities = extract(ty.binder.annotation, yield* V2.ask());

								const [vu, ...usages] = artefacts.usages;
								yield* V2.tell("constraint", { type: "usage", expected: modalities.quantity, computed: vu });

								const sMap = mkSort(ty.binder.annotation, ctx);
								const x = match(sMap)
									.with({ Prim: P.select() }, sort => Z3.Const(tm.binding.variable, sort))
									.with({ Func: P._ }, fn => Z3.Array.const(tm.binding.variable, ...(build(fn) as [Sort, ...Sort[], Sort])))
									.with({ App: P._ }, app => {
										const sort = Z3.Sort.declare(build(app).join(" "));
										return Z3.Const(tm.binding.variable, sort);
									})
									.exhaustive();

								const p = modalities.liquid;
								if (p.type !== "Abs") {
									throw new Error("Liquid refinement must be a unary function");
								}
								const lvl = ctx.env.length;
								const applied = NF.apply(p.binder, p.closure, NF.Constructors.Rigid(lvl));
								const phi = translate(applied, ctx, { [lvl]: x }) as Bool;

								const imp = Z3.ForAll([x], Z3.Implies(phi, artefacts.vc as Bool));

								return { usages, vc: imp };
							}),
						),
				)
				// .with([{ type: "Abs" }, P._], ([abs, ty]) => {
				// 	const ann = NF.evaluate(ctx, abs.binding.annotation);
				// 	return V2.local(ctx => EB.bind(ctx, { type: "Lambda", variable: abs.binding.variable }, ann), V2.Do(function* () {
				// 		const xtended = yield* V2.ask();
				// 		const body = NF.evaluate(xtended, abs.body);
				// 		const vc = yield* subtype.gen(body, ty);
				// 		return { usages: Q.noUsage(xtended.env.length), vc };
				// 	 }));
				// })
				.otherwise(function* ([tm, ty]) {
					const [synthed, artefacts] = yield* synth.gen(tm);
					// Since verification runs after typechecking, we can assume that the term has at least the type we are checking against
					// Therefore, we can lift it to have the type we are checking against, with the added synthed liquid refinement
					// We Many as a dummy quantity, since it has no effect on subtyping
					// const synthed = NF.Constructors.Modal(ty, { quantity: Q.Many, liquid: artefacts.vc });
					const checked = yield* subtype.gen(synthed, ty);
					return { usages: artefacts.usages, vc: Z3.And(artefacts.vc as Bool, checked as Bool) };
				});

			// return r;
			return yield* r;
		});

	check.gen = (tm: EB.Term, ty: NF.Value) => V2.pure(check(tm, ty));

	type Synthed = [NF.Value, Modal.Artefacts];
	const synth = (term: EB.Term): V2.Elaboration<Synthed> =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();

			const r = match(term)
				.with({ type: "Var", variable: { type: "Bound" } }, tm =>
					V2.Do(function* () {
						const entry = ctx.env[tm.variable.index];

						if (!entry) {
							throw new Error("Unbound variable in synth");
						}

						const [binder, , ty] = entry.type;

						const modalities = extract(ty, ctx);
						const zeros = A.replicate<Q.Multiplicity>(ctx.env.length, Q.Zero);
						const usages = A.unsafeUpdateAt(tm.variable.index, modalities.quantity, zeros);

						const v = NF.evaluate(ctx, tm);
						const p = NF.reduce(modalities.liquid, v, "Explicit");

						return [ty, { usages, vc: translate(p, ctx) }] satisfies Synthed; // TODO: probably need to strengthen the refinement with the literal here
					}),
				)
				.with({ type: "Var", variable: { type: "Free" } }, tm => {
					const entry = ctx.imports[tm.variable.name];

					if (!entry) {
						throw new Error(`Unbound free variable: ${tm.variable.name}`);
					}

					const [t, ty, us] = entry;
					const modalities = extract(ty, ctx);

					//const predicate = EB.Constructors.App("Explicit", modalities.liquid, EB.Constructors.Var({ type: "Free", name: tm.variable.name }));

					const p = NF.reduce(modalities.liquid, NF.evaluate(ctx, tm), "Explicit");

					return V2.of<Synthed>([ty, { usages: us, vc: translate(p, ctx) }]);
				})

				.with({ type: "Var" }, tm => {
					console.warn("synth: Other variable types not implemented yet");
					return V2.of<Synthed>([NF.Any, { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }]);
				})
				.with({ type: "Lit" }, tm =>
					V2.Do(function* () {
						const ann = match(tm.value)
							.with({ type: "Atom" }, l => EB.Constructors.Lit(l))
							.with({ type: "Num" }, l => EB.Constructors.Lit({ type: "Atom", value: "Num" }))
							.with({ type: "String" }, l => EB.Constructors.Lit({ type: "Atom", value: "String" }))
							.with({ type: "Bool" }, l => EB.Constructors.Lit({ type: "Atom", value: "Bool" }))
							.with({ type: "unit" }, l => EB.Constructors.Lit({ type: "Atom", value: "Unit" }))
							.exhaustive();
						const nf = NF.evaluate(ctx, ann);

						const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
						const fresh = freshName();
						const closure = NF.Constructors.Closure(ctx, EB.DSL.eq(bound, tm));
						const modalities = {
							quantity: Q.Many,
							liquid: NF.Constructors.Lambda(fresh, "Explicit", closure, nf),
						};
						return [NF.Constructors.Modal(nf, modalities), { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }] satisfies Synthed;
					}),
				)
				.with({ type: "Abs" }, tm =>
					V2.Do(function* () {
						// const modalities = extract(tm.binding.annotation);

						const ann = NF.evaluate(ctx, tm.binding.annotation);
						const [, bArtefacts] = yield* V2.local(_ctx => EB.bind(_ctx, { type: "Pi", variable: tm.binding.variable }, ann), synth(tm.body));

						//const vc = Modal.Verification.implication(NF.evaluate(ctx, modalities.liquid), bArtefacts.vc)

						const icit = tm.binding.type === "Lambda" || tm.binding.type === "Pi" ? tm.binding.icit : "Explicit";
						const type = NF.Constructors.Pi(tm.binding.variable, icit, ann, NF.Constructors.Closure(ctx, tm.body));

						// Note: trying to prevent lambdas from having refinements
						return [type, { usages: bArtefacts.usages, vc: Z3.Bool.val(true) }] satisfies Synthed;
					}),
				)
				.with(EB.CtorPatterns.Variant, EB.CtorPatterns.Schema, rowtype =>
					V2.of<Synthed>([NF.Type, { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }]),
				)
				.with(EB.CtorPatterns.Struct, rowtype =>
					V2.Do(function* () {
						const ctx = yield* V2.ask();

						const toNFVar = (v: EB.Variable): NF.Variable =>
							match(v)
								.with({ type: "Bound" }, ({ index }) => ({ type: "Bound", lvl: ctx.env.length - 1 - index }) as NF.Variable)
								.otherwise(v => v satisfies NF.Variable);

						type Folder = {
							usages: Q.Multiplicity[];
							vc: Expr;
							fields: Array<{ label: string; ty: NF.Value }>;
							tail?: NF.Variable;
						};

						const folder = Row.fold<EB.Term, EB.Variable, V2.Elaboration<Folder>>(
							rowtype.arg.row,
							(value, label, r) =>
								V2.Do(function* () {
									const [ty, art] = yield* synth.gen(value);
									const acc = yield* V2.pure(r);
									const vc = Z3.And(acc.vc as Bool, art.vc as Bool);

									return {
										vc,
										usages: Q.add(acc.usages, art.usages),
										fields: [...acc.fields, { label, ty }],
										tail: acc.tail,
									} satisfies Folder;
								}),
							(v, r) =>
								V2.Do(function* () {
									const acc = yield* V2.pure(r);
									return { ...acc, tail: toNFVar(v) } satisfies Folder;
								}),
							V2.of<Folder>({ usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true), fields: [] }),
						);

						const final = yield* V2.pure(folder);

						const row: NF.Row = final.fields.reduceRight(
							(r: NF.Row, f: { label: string; ty: NF.Value }) => Row.Constructors.Extension(f.label, f.ty, r),
							final.tail ? Row.Constructors.Variable(final.tail) : Row.Constructors.Empty(),
						) satisfies NF.Row;

						return [NF.Constructors.Schema(row), { usages: final.usages, vc: final.vc }] satisfies Synthed;
						// QUESTION in comment about optimizing row terms via specific constructors is orthogonal to verification VC accumulation.
						// We leave that optimization for elaboration/codegen.
					}),
				)
				.with({ type: "App" }, tm =>
					V2.Do(function* () {
						const fn = yield* synth.gen(tm.func);
						const [fnTy, fnArtefacts] = fn;

						const forced = NF.force(ctx, fnTy);
						const modalities = extract(forced, ctx);
						const [out, usages, vc] = yield* V2.pure(
							match(forced)
								.with({ type: "Abs", binder: { type: "Pi" } }, ty =>
									V2.Do(function* () {
										const checked = yield* check.gen(tm.arg, ty.binder.annotation);
										const us = Q.add(fnArtefacts.usages, Q.multiply(modalities.quantity, checked.usages));

										// const applied = NF.reduce(checked.vc, NF.evaluate(ctx, tm.arg), "Explicit");
										// const vc = NF.DSL.Binop.and(fnArtefacts.vc, applied);
										const vc = Z3.And(fnArtefacts.vc as Bool, checked.vc as Bool);
										const nf = NF.evaluate(ctx, tm.arg);

										// NOTE: This is the is Jhala and Vazou's Syn-App rule, which relies on ANF
										const out = NF.apply(ty.binder, ty.closure, nf);

										// NOTE: trying out the alternative existential-based rule (Syn-App-Ex) mentioned in their paper, but which originates from Knowles and Flanagan, 2009 (Contract types)
										// const out = NF.Constructors.Pi(
										// 	ty.binder.variable,
										// 	ty.binder.icit,
										// 	ty.binder.annotation,
										// 	ty.closure
										// )
										// out.binder.sigma = true// FIXME: hack to mark as Sigma for later processing! We need to properly support Sigma!
										return [out, us, vc] as const;
									}),
								)
								.otherwise(ty => {
									console.error("Got: ", NF.display(ty, ctx));
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
				.with({ type: "Block" }, block => {
					const recurse = (stmts: EB.Statement[], results: Modal.Artefacts[]): V2.Elaboration<Synthed> =>
						V2.Do(function* () {
							if (stmts.length === 0) {
								return yield* synth.gen(block.return);
							}

							const [current, ...rest] = stmts;
							if (current.type === "Expression") {
								const synthed = yield* synth.gen(current.value);
								const r = yield* V2.pure(recurse(rest, [...results, synthed[1]]));
								return r;
							}
							if (current.type !== "Let") {
								return yield* V2.pure(recurse(rest, [...results]));
							}

							return yield* V2.local(
								ctx => EB.bind(ctx, { type: "Let", variable: current.variable }, current.annotation),
								V2.Do(function* () {
									const artefacts = yield* check.gen(current.value, current.annotation);
									const [ty, conj] = yield* V2.pure(recurse(rest, [...results, artefacts]));

									return [ty, { usages: conj.usages, vc: Z3.And(artefacts.vc as Bool, conj.vc as Bool) }] satisfies Synthed;
								}),
							);
						});

					return recurse(block.statements, []);
				})
				.otherwise(() => {
					console.warn("synth: Not implemented yet");
					return V2.of<Synthed>([NF.Any, { usages: Q.noUsage(0), vc: Z3.Bool.val(true) }]);
				});
			const ret = yield* V2.pure(r);
			return ret;
		});
	synth.gen = (tm: EB.Term) => V2.pure(synth(tm));

	const extract = (nf: NF.Value, ctx: EB.Context): NF.Modalities =>
		match(nf)
			.with({ type: "Modal" }, m => m.modalities)
			.otherwise(() => ({
				quantity: Q.Many,
				liquid: Liquid.Predicate.NeutralNF(NF.Constructors.Lit({ type: "Atom", value: "Unit" }), ctx),
			}));

	const subtype = (a: NF.Value, b: NF.Value): V2.Elaboration<Modal.Artefacts["vc"]> =>
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

				.with([NF.Patterns.Schema, NF.Patterns.Schema], ([{ arg: a }, { arg: b }]) => {
					return contains(b.row, a.row);
				})
				.with([NF.Patterns.Variant, NF.Patterns.Variant], ([{ arg: a }, { arg: b }]) => {
					return contains(a.row, b.row);
				})
				.with([{ type: "Modal" }, { type: "Modal" }], ([at, bt]) =>
					V2.Do(function* () {
						const ctx = yield* V2.ask();

						// 1) Base type subtyping VC (ensures underlying types are compatible)
						const baseVc = yield* subtype.gen(at.value, bt.value);

						// 2) Evaluate both liquid predicates to NF.Abs under the current context
						const pAt = at.modalities.liquid;
						const pBt = bt.modalities.liquid;
						if (pAt.type !== "Abs" || pBt.type !== "Abs") {
							throw new Error("Liquid refinements must be unary functions");
						}

						// 3) Apply both to a fresh rigid at the current level (no context extension)
						const lvl = ctx.env.length;
						const appliedAt = NF.apply(pAt.binder, pAt.closure, NF.Constructors.Rigid(lvl));
						const appliedBt = NF.apply(pBt.binder, pBt.closure, NF.Constructors.Rigid(lvl));

						// 4) Create the Z3 quantified variable with the primitive sort of the base type
						const sortMap = mkSort(at.value, ctx);
						const xSort = match(sortMap)
							.with({ Prim: P.select() }, p => p)
							.otherwise(() => {
								throw new Error("Only primitive types can be used in logical formulas");
							});
						const fresh = freshName();
						const x = Z3.Const(fresh, xSort);

						// 5) Translate with a rigids map so the fresh rigid maps to the quantifier
						// TODO:FIXME: Use free variables instead of rigids. Add a new translation environment for them in the context
						const rigids = { [lvl]: x } as Record<number, Expr>;
						const phiAt = translate(appliedAt, ctx, rigids) as Bool;
						const phiBt = translate(appliedBt, ctx, rigids) as Bool;

						// 6) Forall x. phiAt(x) => phiBt(x), conjoined with the base VC
						const forall: Bool = Z3.ForAll([x], Z3.Implies(phiAt, phiBt));
						return Z3.And(baseVc as Bool, forall);
					}),
				)
				.with([{ type: "Modal" }, P._], ([at, bt]) => subtype(at, NF.Constructors.Modal(bt, { quantity: Q.Zero, liquid: Liquid.Predicate.NeutralNF(bt, ctx) })))
				.with([P._, { type: "Modal" }], ([at, bt]) => subtype(NF.Constructors.Modal(at, { quantity: Q.Many, liquid: Liquid.Predicate.NeutralNF(at, ctx) }), bt))
				.with(
					[{ type: "Abs", binder: { type: "Pi" } }, P._],
					([abs]) => abs.binder.sigma,
					([sig, ty]) =>
						V2.Do(function* () {
							// const ann = NF.evaluate(ctx, abs.binder.annotation);
							const r = V2.local(
								ctx => EB.bind(ctx, { type: "Lambda", variable: sig.binder.variable }, sig.binder.annotation),
								V2.Do(function* () {
									const xtended = yield* V2.ask();
									const body = NF.apply(sig.binder, sig.closure, NF.Constructors.Rigid(xtended.env.length));
									// const body = NF.evaluate(xtended, abs.body);
									const vc = yield* subtype.gen(body, ty);
									return vc;
								}),
							);
							return yield* r;
						}),
				)
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

							const vc = Z3.Implies(vcArg as Bool, vcBody as Bool);
							return vc;
						}),
				)

				.with([NF.Patterns.Lit, NF.Patterns.Lit], ([{ value: v1 }, { value: v2 }]) => {
					return V2.of(Z3.Bool.val(isEqual(v1, v2)));
				})
				.otherwise(([a, b]) =>
					V2.Do(function* () {
						const ctx = yield* V2.ask();
						console.warn("Subtype not fully implemented yet");
						console.log("A:", NF.display(a, ctx));
						console.log(a);
						console.log("B:", NF.display(b, ctx));
						console.log(b);
						console.log(ctx.zonker);
						return Z3.Bool.val(false);
					}),
				);

			// return s as Modal.Annotations["liquid"];
			const r = yield* V2.pure(s);
			return r;
		});
	subtype.gen = (a: NF.Value, b: NF.Value) => V2.pure(subtype(a, b));

	const contains = (a: NF.Row, b: NF.Row) => {
		const onVal = (v: NF.Value, lbl: string, conj: V2.Elaboration<Modal.Artefacts["vc"]>): V2.Elaboration<Modal.Artefacts["vc"]> => {
			const ra = Row.rewrite(a, lbl, v => E.left({ tag: "Other", message: `Could not rewrite row. Label ${lbl} not found.` }));
			return F.pipe(
				ra,
				E.fold(
					err => V2.Do<Modal.Artefacts["vc"], any>(() => V2.fail({ type: "MissingLabel", label: lbl, row: a })),
					rewritten => {
						if (rewritten.type !== "extension") {
							throw new Error("Verification Subtyping: Expected extension after rewriting row");
						}

						return V2.Do(function* () {
							const accumulated = yield* V2.pure(conj);
							const vc = yield* subtype.gen(v, rewritten.value);
							return Z3.And(accumulated as Bool, vc as Bool);
						});
					},
				),
			);
		};
		return Row.fold(b, onVal, (rv, acc) => acc, V2.of(Z3.Bool.val(true) satisfies Modal.Artefacts["vc"]));
	};
	const mkFunction = (val: NF.Value, ctx: EB.Context): SMTArray<"main", [Sort<"main">, ...Sort<"main">[]], Sort<"main">> => {
		return match(val)
			.with(NF.Patterns.Var, ({ variable }) => {
				const getNameAndType = (variable: NF.Variable) => {
					if (variable.type === "Bound") {
						const {
							type: [, , type],
							name,
						} = ctx.env[EB.lvl2idx(ctx, variable.lvl)];
						return { name: name.variable, type };
					}
					if (variable.type === "Free") {
						const [, type] = ctx.imports[variable.name];
						return { name: variable.name, type };
					}
					if (variable.type === "Label") {
						const { ann } = ctx.sigma[variable.name];
						return { name: variable.name, type: ann };
					}
					if (variable.type === "Foreign") {
						if (!(variable.name in PrimOps)) {
							throw new Error("MKFunc: Foreign variables should not appear in logical formulas");
						}
						const [, type] = ctx.imports[operatorMap[variable.name]];
						return { name: variable.name, type };
					}
					if (variable.type === "Meta") {
						const m = ctx.metas[variable.val];
						if (!m) {
							throw new Error("MKFunc: Meta variables should not appear in logical formulas");
						}
						return { name: `?${variable.val}`, type: m.ann };
					}
					throw new Error("MKFunc: Unknown variable type");
				};

				const { name, type } = getNameAndType(variable);
				const sort = mkSort(type, ctx);
				const all = build(sort) as [Sort, ...Sort[], Sort];
				const f = Z3.Array.const(name, ...all);
				return f;
			})
			.with(NF.Patterns.App, a => mkFunction(a.func, ctx))
			.with({ type: "External" }, e => {
				if (e.args.length !== e.arity) {
					throw new Error("External with wrong arity in logical formulas");
				}
				const args = e.args.flatMap(arg => build(mkSort(arg, ctx))) as [Sort, ...Sort[], Sort];

				const f = Z3.Array.const(e.name, ...args);
				return f;
			})
			.with({ type: "Abs" }, a => {
				throw new Error("Function literals not supported in logical formulas");
			})
			.otherwise(() => {
				throw new Error("Not a function");
			});
	};

	const translate = (nf: NF.Value, ctx: EB.Context, rigids: Record<number, Expr> = {}): Expr => {
		const collectArgs = (value: NF.Value, ctx: EB.Context): Expr[] => {
			return match(value)
				.with(NF.Patterns.App, ({ func, arg }) => {
					const fs = collectArgs(func, ctx);
					const a = translate(arg, ctx, rigids);
					return fs.concat(a);
				})
				.otherwise(() => [translate(value, ctx, rigids)]);
		};

		const r = match(nf)
			.with({ type: "Neutral" }, n => translate(n.value, ctx, rigids))
			.with({ type: "Modal" }, m => translate(m.value, ctx, rigids))
			.with(NF.Patterns.Lit, l =>
				match(l.value)
					.with({ type: "Num" }, l => Z3.Real.val(l.value))
					.with({ type: "Bool" }, l => Z3.Bool.val(l.value))
					.with({ type: "String" }, l => {
						throw new Error("String literals not supported yet");
					})
					.with({ type: "unit" }, l => Z3.Const("unit", Sorts.Unit))

					.with({ type: "Atom" }, atom => Z3.Const(atom.value, Sorts.Atom))
					.exhaustive(),
			)
			.with(NF.Patterns.Row, r => {
				throw new Error("Row literals not supported yet");
			})
			.with({ type: "Abs" }, a => {
				throw new Error("Function literals not supported in logical formulas");
			})
			.with(NF.Patterns.App, fn => {
				const f = mkFunction(fn.func, ctx);
				const [, ...args] = collectArgs(fn, ctx);

				const call = f.select(args[0], ...args.slice(1));
				return call;
			})
			.with(NF.Patterns.Var, v => {
				if (v.variable.type === "Bound") {
					// If this level is in the rigids map, use the quantified variable directly
					const mapped = rigids[v.variable.lvl];

					if (mapped) {
						return mapped;
					}

					const {
						nf,
						name,
						type: [, , type],
					} = ctx.env[EB.lvl2idx(ctx, v.variable.lvl)];
					const all = build(mkSort(type, ctx));
					const sort = all.length === 1 ? all[0] : Z3.Sort.declare(all.join(" -> "));
					return Z3.Const(name.variable, sort);
				}
				if (v.variable.type === "Free") {
					const [a] = ctx.imports[v.variable.name];
					return translate(NF.evaluate(ctx, a), ctx, rigids);
				}
				if (v.variable.type === "Label") {
					const { nf } = ctx.sigma[v.variable.name];
					return translate(nf, ctx, rigids);
				}
				if (v.variable.type === "Foreign") {
					throw new Error("Translation Error: Foreign variables should not appear in logical formulas");
				}
				if (v.variable.type === "Meta") {
					throw new Error("Translation Error: Meta variables should not appear in logical formulas");
				}
				throw new Error("Translation Error: Unknown variable type");
			})
			.with({ type: "External" }, e => {
				if (e.args.length !== e.arity) {
					throw new Error("External with wrong arity in logical formulas");
				}
				const args = e.args.map(arg => translate(arg, ctx, rigids));
				const r = (() => {
					if (e.name === OP_ADD) {
						return (args[0] as IntNum).add(args[1] as IntNum);
					}

					if (e.name === OP_SUB) {
						return (args[0] as IntNum).sub(args[1] as IntNum);
					}

					if (e.name === OP_MUL) {
						return (args[0] as IntNum).mul(args[1] as IntNum);
					}

					if (e.name === OP_DIV) {
						return (args[0] as IntNum).div(args[1] as IntNum);
					}

					if (e.name === OP_AND) {
						return Z3.And(args[0] as Bool, args[1] as Bool);
					}

					if (e.name === OP_OR) {
						return Z3.Or(args[0] as Bool, args[1] as Bool);
					}

					if (e.name === OP_NOT) {
						return (args[0] as Bool).not();
					}

					if (e.name === OP_EQ) {
						return args[0].eq(args[1]);
					}

					if (e.name === OP_NEQ) {
						return args[0].neq(args[1]);
					}

					if (e.name === OP_GT) {
						return (args[0] as IntNum).gt(args[1] as IntNum);
					}

					if (e.name === OP_GTE) {
						return (args[0] as IntNum).ge(args[1] as IntNum);
					}

					if (e.name === OP_LT) {
						return (args[0] as IntNum).lt(args[1] as IntNum);
					}

					if (e.name === OP_LTE) {
						return (args[0] as IntNum).le(args[1] as IntNum);
					}

					throw new Error(`Unknown external function in logical formulas: ${e.name}`);
				})();
				return r;
			})
			.otherwise(x => {
				throw new Error("Unknown expression type");
			});

		return r;

		// const a = Z3.Datatype("String")
		// a.declare("mkString");
		// a.create()

		// const x = Z3.Int.const('x');
		// const A = Z3.Sort.declare("A")

		// const implication = Z3.Implies(x.ge(5), x.gt(10));
		// Z3.solve(Z3.And(x.ge(10), x.le(9)));
	};

	type SortMap = { Prim: Sort } | { Func: SortMap[] } | { App: SortMap[] };
	// TODO: get rid of SortMap and return a Sort directly from mkSort. Update all callsites accordingly
	const mkSort = (nf: NF.Value, ctx: EB.Context): SortMap => {
		const s = match(nf)
			.with({ type: "Neutral" }, n => mkSort(n.value, ctx))
			.with({ type: "Modal" }, m => mkSort(m.value, ctx))
			.with(
				NF.Patterns.Lit,
				l =>
					match(l.value)
						// @ts-ignore
						.with({ type: "Atom" }, ({ value }) => ({ Prim: Sorts[value] || Sorts.Atom }))
						.otherwise(_ => {
							throw new Error("Unknown literal type");
						}),
				// .exhaustive()
			)
			.with(NF.Patterns.Row, r => ({ Prim: Sorts.Row }))
			.with(NF.Patterns.App, ({ func, arg }) => ({ App: [mkSort(func, ctx), mkSort(arg, ctx)] }))
			.with({ type: "Abs" }, ({ binder, closure }) => {
				const body = NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length));
				const argSort = mkSort(binder.annotation, ctx);
				const retSort = mkSort(body, ctx);
				return { Func: [argSort, retSort] };
			})
			.with({ type: "External" }, e => {
				return { Prim: Z3.Sort.declare(`External:${e.name}`) };
			})
			.with(NF.Patterns.Var, v => {
				const { type } = v.variable;

				if (type === "Bound") {
					return mkSort(ctx.env[v.variable.lvl].nf, ctx);
				}

				if (type === "Meta") {
					const ty = ctx.zonker[v.variable.val];
					if (!ty) {
						throw new Error("Unconstrained meta variable in verification");
					}
					return mkSort(ty, ctx);
				}

				if (type === "Free") {
					return { Prim: Z3.Sort.declare(v.variable.name) };
				}

				if (type === "Foreign") {
					return { Prim: Z3.Sort.declare(v.variable.name) };
				}

				if (type === "Label") {
					return { Prim: Z3.Sort.declare(v.variable.name) };
				}

				throw new Error("Could not create sort from variable");
			})
			.exhaustive();
		return s;
	};

	const build = (s: SortMap): Sort[] =>
		match(s)
			.with({ Prim: P.select() }, p => [p])
			.with({ App: P.select() }, App => {
				const [f, a] = App;
				const fs = build(f).map(s => s.name);
				const as = build(a).map(s => s.name);

				const sort = Z3.Sort.declare(`App(${fs.join(",")}, ${as.join(",")})`);
				return [sort];
			})
			.with({ Func: P.select() }, Func => {
				const [a, body] = Func;
				const as = build(a);
				const bs = build(body);
				return as.concat(bs);
			})
			.exhaustive();

	return { check, synth, subtype };
};
