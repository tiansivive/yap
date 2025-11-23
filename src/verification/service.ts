import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Sub from "@yap/elaboration/unification/substitution";
import { nextCount } from "@yap/elaboration/shared/supply";

import * as A from "fp-ts/Array";
import * as E from "fp-ts/Either";
import * as F from "fp-ts/function";
import * as O from "fp-ts/Option";

import * as Q from "@yap/shared/modalities/multiplicity";

import * as Modal from "@yap/verification/modalities/shared";
import * as Row from "@yap/shared/rows";

import { match, P } from "ts-pattern";
import { Liquid } from "./modalities";
import { isEqual } from "lodash";

import * as R from "@yap/shared/rows";
import * as Err from "@yap/elaboration/shared/errors";

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
import { setProp, update } from "@yap/utils";
import assert from "assert";

export const VerificationService = (Z3: Context<"main">, { logging } = { logging: false }) => {
	const Sorts = {
		Int: Z3.Int.sort(),
		Num: Z3.Real.sort(),
		Bool: Z3.Bool.sort(),
		String: Z3.Sort.declare("String"),
		Unit: Z3.Sort.declare("Unit"),
		Row: Z3.Sort.declare("Row"),
		/**
		 *  Schema is a placeholder for record types
		 *  // QUESTION: Do we need to encode the row structure here?
		 */
		Schema: Z3.Sort.declare("Schema"),
		Atom: Z3.Sort.declare("Atom"),
		Type: Z3.Sort.declare("Type"),
		Function: Z3.Sort.declare("Function"),

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
				.with({ Row: P._ }, _ => "Row")
				.with({ Recursive: P._ }, r => "Mu")
				.exhaustive(),
	};

	// Lightweight reporter for local, closed obligations
	type Obligation = {
		label: string;
		expr: Expr;
		context?: {
			term?: string;
			type?: string;
			description?: string | string[];
		};
	};
	let obligations: Obligation[] = [];
	const record = (label: string, expr: Expr, context?: Obligation["context"]): Expr => {
		obligations.push({ label, expr, context });
		return expr;
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

	// console.log("\n\n---------------- Verification Service ----------------");

	let indentation = 0;
	const prefix = (track: boolean = true) => `${track ? "|" : " "}\t`.repeat(indentation);
	const log = (...msgs: string[]) => {
		if (!logging) {
			return;
		}
		console.log(prefix() + msgs.join("\n" + prefix(false)));
	};

	/**
	 * Selfify: Strengthen a variable's type with self-equality refinement.
	 * Given a variable `x` of type `T`, return `T [| λv -> v == x |]`.
	 *
	 * If T already has a liquid refinement, conjoin the equality.
	 * If T does not admit refinements (variants, schemas, sigmas, functions, mu), return T unchanged.
	 * FIXME: the indexes for the tm get out of sync because of the added liquid binder. Need to fix that.
	 */
	const selfify = (tm: EB.Term, ty: NF.Value, ctx: EB.Context): NF.Value => {
		// Create the self-equality term: v == tm
		const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
		const nf = NF.evaluate(ctx, tm);
		const eqTerm = (ctx: EB.Context) => EB.DSL.eq(bound, NF.quote(ctx, ctx.env.length + 1, nf));

		return match(ty)
			.with({ type: "Modal" }, modal => {
				const { liquid } = modal.modalities;
				assert(liquid.type === "Abs" && liquid.binder.type === "Lambda", "Liquid refinement must be an abstraction");

				return NF.Constructors.Modal(modal.value, {
					quantity: modal.modalities.quantity,
					liquid: update(liquid, "closure.term", tm => EB.DSL.and(tm, eqTerm(liquid.closure.ctx))),
				});
			})
			.with({ type: "Abs" }, _ => ty) // Functions cannot be selfified
			.otherwise(ty => {
				const liquid = NF.Constructors.Lambda("v", "Explicit", NF.Constructors.Closure(ctx, eqTerm(ctx)), ty);
				return NF.Constructors.Modal(ty, {
					quantity: Q.One,
					liquid,
				});
			});
	};

	/**
	 * Verification meet: Combine scrutinee type with pattern type to get refined type.
	 *
	 * This is different from NF.meet which extracts bindings from pattern matching.
	 * Here we're combining two TYPES to produce a more refined type that incorporates
	 * constraints from both.
	 *
	 * Based on Core.hs meet function.
	 */
	const meet = (ctx: EB.Context, scrutineeTy: NF.Value, patternTy: NF.Value): NF.Value => {
		const s = NF.unwrapNeutral(scrutineeTy);
		const p = NF.unwrapNeutral(patternTy);

		return (
			match([s, p])
				// Existential in scrutinee type: unpack and meet body with pattern type
				// Use the existential's stored context for the body
				.with([{ type: "Existential" }, P._], ([ex]) => {
					const xtended = EB.bind(ex.body.ctx, { type: "Pi", variable: ex.variable }, ex.annotation);
					const met = meet(xtended, ex.body.value, patternTy);
					return NF.Constructors.Exists(ex.variable, ex.annotation, { ctx: ex.body.ctx, value: met });
				})

				// Both refined: conjoin predicates
				.with([{ type: "Modal" }, { type: "Modal" }], ([sm, pm]) => {
					const sl = sm.modalities.liquid;
					const pl = pm.modalities.liquid;

					assert(sl.type === "Abs" && sl.binder.type === "Lambda", "Scrutinee liquid must be lambda");
					assert(pl.type === "Abs" && pl.binder.type === "Lambda", "Pattern liquid must be lambda");

					// Conjoin the two predicates
					assert(sl.closure.type === "Closure" && pl.closure.type === "Closure", "Liquid closures must be Closure type");
					const conjoined = NF.Constructors.Lambda(
						sl.binder.variable,
						"Explicit",
						NF.Constructors.Closure(sl.closure.ctx, EB.DSL.and(sl.closure.term, pl.closure.term)),
						sl.binder.annotation,
					);

					return NF.Constructors.Modal(sm.value, {
						quantity: sm.modalities.quantity, // Use scrutinee's quantity
						liquid: conjoined,
					});
				})

				// Scrutinee Modal, pattern not: meet underlying types and keep scrutinee's refinement
				.with([{ type: "Modal" }, P._], ([sm]) => {
					const metBase = meet(ctx, sm.value, patternTy);
					return NF.Constructors.Modal(metBase, sm.modalities);
				})

				// Pattern Modal, scrutinee not: meet underlying types and keep pattern's refinement
				.with([P._, { type: "Modal" }], ([, pm]) => {
					const metBase = meet(ctx, scrutineeTy, pm.value);
					return NF.Constructors.Modal(metBase, pm.modalities);
				})

				// Pi types: meet domains and codomains
				.with(
					[
						{ type: "Abs", binder: { type: "Pi" } },
						{ type: "Abs", binder: { type: "Pi" } },
					],
					([st, pt]) => {
						const metDomain = meet(ctx, st.binder.annotation, pt.binder.annotation);
						const xtended = EB.bind(ctx, st.binder, st.binder.annotation);

						const stBody = NF.apply(st.binder, st.closure, NF.Constructors.Rigid(ctx.env.length));
						const ptBody = NF.apply(pt.binder, pt.closure, NF.Constructors.Rigid(ctx.env.length));
						const metCodomain = meet(xtended, stBody, ptBody);

						return NF.Constructors.Pi(
							st.binder.variable,
							st.binder.icit,
							metDomain,
							NF.Constructors.Closure(xtended, NF.quote(xtended, xtended.env.length, metCodomain)),
						);
					},
				)

				// Row types: meet row contents
				.with(
					[
						{ type: "App", arg: { type: "Row" } },
						{ type: "App", arg: { type: "Row" } },
					],
					([sApp, pApp]) => {
						// Both are row applications (schemas/variants/records)
						// Meet the row contents field-by-field
						const metRow = meetRow(ctx, sApp.arg.row, pApp.arg.row);
						return NF.Constructors.App(sApp.func, NF.Constructors.Row(metRow), sApp.icit);
					},
				)

				.otherwise(() => patternTy)
		);
	};

	/**
	 * Meet two rows field-by-field, conjoining refinements where fields overlap
	 */
	const meetRow = (ctx: EB.Context, sRow: NF.Row, pRow: NF.Row): NF.Row => {
		return match([sRow, pRow])
			.with([{ type: "empty" }, P._], () => pRow)
			.with([P._, { type: "empty" }], () => sRow)
			.with([{ type: "variable" }, P._], () => pRow)
			.with([P._, { type: "variable" }], () => sRow)
			.with([{ type: "extension" }, { type: "extension" }], ([sr, pr]): NF.Row => {
				// Try to find matching field in pattern row
				const rewritten = R.rewrite(pRow, sr.label);

				if (E.isLeft(rewritten)) {
					// Field not in pattern, keep scrutinee field and continue
					return { type: "extension" as const, label: sr.label, value: sr.value, row: meetRow(ctx, sr.row, pRow) };
				}

				if (rewritten.right.type !== "extension") {
					throw new Error("Rewriting row extension should yield extension");
				}

				// Field found in both: meet the values
				const metValue = meet(ctx, sr.value, rewritten.right.value);
				const metRest = meetRow(ctx, sr.row, rewritten.right.row);

				return { type: "extension" as const, label: sr.label, value: metValue, row: metRest };
			})
			.exhaustive();
	};
	const check = (tm: EB.Term, ty: NF.Value): V2.Elaboration<Modal.Artefacts> =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			indentation++;
			log(`Checking`, EB.Display.Term(tm, ctx), `Against:`, NF.display(ty, ctx), "Env:", EB.Display.Env(ctx));

			const r = yield* match([tm, NF.force(ctx, ty)])
				.with([{ type: "Modal" }, NF.Patterns.Type], ([tm, ty]) => check.gen(tm.term, ty))
				.with([EB.CtorPatterns.Mu, P._], ([tm, ty]) => {
					// TODO subtype mu annotation against ty?
					return V2.local(ctx => EB.bind(ctx, { type: "Mu", variable: tm.binding.variable }, ty), check(tm.body, ty));
				})
				.with(
					[P._, NF.Patterns.App],
					([, ty]) => O.isSome(NF.unfoldMu(ty)),
					function* ([tm, ty]) {
						const unfolded = NF.unfoldMu(ty);
						assert(unfolded._tag === "Some");
						return yield* check.gen(tm, unfolded.value);
					},
				)
				.with([{ type: "Abs" }, { type: "Abs", binder: { type: "Pi" } }], function* ([tm, ty]) {
					const vc = yield* V2.local(
						ctx => EB.bind(ctx, { type: "Lambda", variable: tm.binding.variable }, ty.binder.annotation),
						V2.Do(function* () {
							const xtended = yield* V2.ask();
							const tyBody = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));
							const artefacts = yield* check.gen(tm.body, tyBody);

							const modalities = extract(ty.binder.annotation, yield* V2.ask());

							const [vu, ...usages] = artefacts.usages;
							yield* V2.tell("constraint", { type: "usage", expected: modalities.quantity, computed: vu });

							if (ty.binder.annotation.type === "Abs") {
								return artefacts;
							}

							const p = modalities.liquid;
							const sMap = mkSort(ty.binder.annotation, xtended);
							const x = match(sMap)
								.with({ Prim: P.select() }, sort => Z3.Const(tm.binding.variable, sort))
								.with({ Func: P._ }, fn => Z3.Array.const(tm.binding.variable, ...(build(fn) as [Sort, ...Sort[], Sort])))
								.with({ App: P._ }, app => {
									const sorts = build(app);
									const name = `App_${sorts.map(s => s.name()).join("_")}`;
									const sort = Z3.Sort.declare(name);
									return Z3.Const(tm.binding.variable, sort);
								})
								.with({ Recursive: P.select() }, r => Z3.Const(tm.binding.variable, r))
								.with({ Row: P.select() }, r => Z3.Const(tm.binding.variable, r))

								.exhaustive();

							if (p.type !== "Abs") {
								throw new Error("Liquid refinement must be a unary function");
							}
							const lvl = xtended.env.length;
							const applied = NF.apply(p.binder, p.closure, NF.Constructors.Rigid(lvl));
							const phi = translate(applied, xtended, { [lvl]: x }) as Bool;

							const implicationDesc = `Forall ${ty.binder.variable}. ${NF.display(ty.binder.annotation, ctx)} ==>  ${NF.display(tyBody, xtended)} }`;
							const imp = record("check.abs.quantification", Z3.ForAll([x], Z3.Implies(phi, artefacts.vc as Bool)) as Bool, {
								type: NF.display(ty, ctx),
								description: [`Function term must satisfy body's postcondition under the precondition on ${tm.binding.variable}`, implicationDesc],
							}) as Bool;

							return { usages, vc: imp };
						}),
					);

					return vc;
				})

				.with([EB.CtorPatterns.Struct, NF.Patterns.Sigma], ([tm, ty]) => {
					const rv = NF.evaluate(ctx, tm);
					assert(rv.type === "App" && rv.arg.type === "Row", "Expected struct term to evaluate to an application of a row");
					const schema = NF.apply(ty.binder, ty.closure, NF.Constructors.Row(rv.arg.row));
					return check.gen(tm, schema);
				})
				.with([EB.CtorPatterns.Struct, NF.Patterns.Variant], function* ([tm, ty]) {
					const nf = NF.evaluate(ctx, tm);
					assert(nf.type === "App" && nf.arg.type === "Row", "Expected struct term to evaluate to an application of a row");
					const contains = (a: NF.Row, b: EB.Row) => {
						const onVal = (t: EB.Term, lbl: string, conj: V2.Elaboration<Modal.Artefacts["vc"]>): V2.Elaboration<Modal.Artefacts["vc"]> => {
							const ra = Row.rewrite(a, lbl, v => E.left({ tag: "Other", message: `Could not rewrite row. Label ${lbl} not found.` }));
							return F.pipe(
								ra,
								E.fold(
									err => V2.Do<Modal.Artefacts["vc"], any>(() => V2.fail({ type: "MissingLabel", label: lbl, row: a })),
									rewritten =>
										V2.Do(function* () {
											assert(rewritten.type === "extension", "Verification Subtyping: Expected extension after rewriting row");
											const accumulated = yield* V2.pure(conj);
											const { vc } = yield* check.gen(t, rewritten.value);
											return Z3.And(accumulated as Bool, vc as Bool);
										}),
								),
							);
						};
						return Row.fold(b, onVal, (rv, acc) => acc, V2.of(Z3.Bool.val(true) satisfies Modal.Artefacts["vc"]));
					};

					const result = yield* V2.pure(contains(ty.arg.row, tm.arg.row));

					return { usages: Q.noUsage(ctx.env.length), vc: result };
				})
				.with([EB.CtorPatterns.Struct, NF.Patterns.Schema], ([tm, ty]) => {
					//trick to evaluate dependent fields
					const nf = NF.evaluate(ctx, tm);
					//Might be missing sigma env information here
					const traverse = (r1: NF.Row, r2: NF.Row): V2.Elaboration<Modal.Artefacts> => {
						const res = match([r1, r2])
							.with([{ type: "empty" }, { type: "empty" }], () => V2.of<Modal.Artefacts>({ usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }))
							.with([{ type: "empty" }, { type: "variable" }], () => V2.of<Modal.Artefacts>({ usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }))
							.with([{ type: "extension" }, { type: "extension" }], ([{ label, value, row }, r]) =>
								V2.Do(function* () {
									const rewritten = R.rewrite(r, label);
									if (E.isLeft(rewritten)) {
										return yield* V2.fail<Modal.Artefacts>(Err.MissingLabel(label, r));
									}

									if (rewritten.right.type !== "extension") {
										return yield* V2.fail<Modal.Artefacts>({
											type: "Impossible",
											message: "Rewritting a row extension should result in another row extension",
										});
									}

									const { value: rv, row: rr } = rewritten.right;

									const artefacts = yield* check.gen(NF.quote(ctx, ctx.env.length, value), rv);
									const rest = yield* V2.pure(traverse(row, rr));

									const combinedVc = Z3.And(artefacts.vc as Bool, rest.vc as Bool);
									const combinedUsages = Q.add(artefacts.usages, rest.usages);
									return { usages: combinedUsages, vc: combinedVc } satisfies Modal.Artefacts;
								}),
							)
							.otherwise(_ => {
								throw new Error("Schema verification: incompatible rows");
							});
						return res;
					};

					const result = match(nf)
						.with(NF.Patterns.Struct, struct =>
							V2.Do(function* () {
								const bindings = yield* V2.pure(collect(struct.arg.row, ty.arg.row));
								return yield* V2.local(
									update("sigma", sig => ({ ...sig, ...bindings })),
									traverse(struct.arg.row, ty.arg.row),
								);
							}),
						)
						.otherwise(() => {
							throw new Error("Schema verification: expected struct term");
						});

					return V2.pure(result) as any;

					//return 1 as any
				})

				.with([EB.CtorPatterns.Match, P._], function* ([tm, ty]) {
					const { alternatives, scrutinee } = tm;

					log("-------------------------------------------");
					log("Match: Scrutinee");
					log("-------------------------------------------");

					const [scrutineeTy, scrutineeArtefacts] = yield* synth.gen(scrutinee);

					log("-------------------------------------------");
					log("Match: Alternatives");
					log("-------------------------------------------");

					const checkAlt = (alt: EB.Alternative): V2.Elaboration<Modal.Artefacts> =>
						V2.Do(function* () {
							const ctx = yield* V2.ask();
							const { pattern, term: branch, binders } = alt;

							log("Checking alternative:", EB.Display.Pattern(pattern), "=>", EB.Display.Term(branch, ctx));

							const [patternTy, patternArtefacts] = yield* synthPattern.gen(pattern, scrutineeTy);
							// Meet the scrutinee type with the pattern type to get refined type
							const met = meet(ctx, scrutineeTy, patternTy);

							log("Met type:", NF.display(met, ctx));

							// Extend context with pattern binders
							const extend: (ctx: EB.Context) => EB.Context = ctx => binders.reduce((c, [name, ty]) => EB.bind(c, { type: "Lambda", variable: name }, ty), ctx);

							const branchArtefacts = yield* V2.local(extend, check(branch, ty));

							// Quantify over pattern binders in reverse order
							const quantifyBinders = (vc: Expr) =>
								binders
									.slice()
									.reverse()
									.reduce((vc, [name, ty]) => quantify(name, ty, vc, ctx), vc);

							// Generate a fresh variable to quantify over the met type
							// This creates the implication: ∀fresh. met(fresh) => vc
							// The met type contains the conjoined refinements from scrutinee and pattern
							const freshVar = `$fresh${nextCount()}`;
							const vc = quantify(freshVar, met, quantifyBinders(branchArtefacts.vc), ctx);
							const combinedVc = Z3.And(scrutineeArtefacts.vc as Bool, patternArtefacts.vc as Bool, vc as Bool);
							const us = Q.add(scrutineeArtefacts.usages, Q.add(patternArtefacts.usages, branchArtefacts.usages));

							return { usages: us, vc: combinedVc } satisfies Modal.Artefacts;
						});

					const alts = yield* V2.pure(V2.traverse(alternatives, checkAlt));
					const vc = alts.reduce((v, a) => Z3.And(v, a.vc as Bool), Z3.Bool.val(true) as Bool);
					const us = alts.reduce((acc, a) => Q.add(acc, a.usages), scrutineeArtefacts.usages);

					// const fresh = `$fresh${nextCount()}`;
					// const quantifiedVc = quantify(fresh, scrutineeTy, vc, ctx);
					return { usages: us, vc } satisfies Modal.Artefacts;
				})
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

			log("Check result VC:", r.vc.sexpr().replaceAll("\n", " ").replaceAll(/\s+/g, " "));
			indentation--;
			return r;
		});

	check.gen = (tm: EB.Term, ty: NF.Value) => V2.pure(check(tm, ty));

	type Synthed = [NF.Value, Modal.Artefacts];
	const synth = (term: EB.Term): V2.Elaboration<Synthed> =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();

			indentation++;
			log("Synthesizing:", EB.Display.Term(term, ctx));
			const r = match(term)
				.with({ type: "Var", variable: { type: "Bound" } }, tm =>
					V2.Do(function* () {
						const entry = ctx.env[tm.variable.index];

						if (!entry) {
							throw new Error("Unbound variable in synth");
						}

						const [binder, , ty] = entry.type;

						// Apply selfify rule: strengthen type with self-equality
						const selfified = selfify(tm, ty, ctx);

						const modalities = extract(selfified, ctx);
						const zeros = A.replicate<Q.Multiplicity>(ctx.env.length, Q.Zero);
						const usages = A.unsafeUpdateAt(tm.variable.index, modalities.quantity, zeros);

						const v = NF.evaluate(ctx, tm);
						const p = NF.reduce(modalities.liquid, v, "Explicit");

						return [selfified, { usages, vc: translate(p, ctx) }] satisfies Synthed;
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
						//NOTE:IMPORTANT: empty env to avoid capturing at the refinement level. We're lifitng the primitive vlaue to the refinement, so we need to be careful
						const closure = NF.Constructors.Closure(noCapture(ctx), EB.DSL.eq(bound, tm));
						const modalities = {
							quantity: Q.Many,
							liquid: NF.Constructors.Lambda(fresh, "Explicit", closure, nf),
						};
						return [NF.Constructors.Modal(nf, modalities), { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }] satisfies Synthed;
					}),
				)
				.with(EB.CtorPatterns.Pi, EB.CtorPatterns.Mu, EB.CtorPatterns.Sigma, abs =>
					V2.of<Synthed>([NF.Type, { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }]),
				)
				.with(EB.CtorPatterns.Lambda, tm =>
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
						const incorporate = (argTy: NF.Value, fnTy: NF.Value): V2.Elaboration<Synthed> =>
							V2.Do(function* () {
								const ctx = yield* V2.ask();

								log("Incorporating argument type", NF.display(argTy, ctx), "into function type", NF.display(fnTy, ctx), "Env:", EB.Display.Env(ctx));

								const synthed = match(fnTy)
									.with({ type: "Existential" }, ex =>
										V2.Do(() =>
											V2.local(
												ctx => EB.bind(ctx, { type: "Pi", variable: ex.variable }, ex.annotation),
												V2.Do(function* () {
													const xtended = yield* V2.ask();
													const [out, as] = yield* V2.pure(incorporate(argTy, ex.body.value));
													return [NF.Constructors.Exists(ex.variable, ex.annotation, { ctx: ctx, value: out }), as] satisfies Synthed;
												}),
											),
										),
									)
									.with(NF.Patterns.Pi, pi =>
										V2.Do(function* () {
											const vc = yield* subtype.gen(argTy, pi.binder.annotation);
											const nf = NF.evaluate(ctx, tm.arg);
											const out =
												nf.type !== "Neutral" ? NF.apply(pi.binder, pi.closure, nf) : NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(ctx.env.length));
											return [
												NF.Constructors.Exists(pi.binder.variable, argTy, { value: out, ctx }),
												{ usages: Q.noUsage(ctx.env.length), vc },
											] satisfies Synthed;
										}),
									)
									.otherwise(() => {
										console.error("Got:", NF.display(fnTy, ctx));
										throw new Error("Impossible: Function type expected in application");
									});
								return yield* V2.pure(synthed);
							});

						const fn = yield* synth.gen(tm.func);
						const [fnTy, fnArtefacts] = fn;
						const arg = yield* synth.gen(tm.arg);
						const [argTy, argArtefacts] = arg;

						const result = yield* V2.pure(incorporate(NF.force(ctx, argTy), NF.force(ctx, fnTy)));
						// Merge artefacts from function, argument, and the application rule itself
						const [outTy, outArt] = result;
						const mergedVc = Z3.And(fnArtefacts.vc as Bool, argArtefacts.vc as Bool, outArt.vc as Bool);
						const mergedUsages = Q.add(Q.add(fnArtefacts.usages, argArtefacts.usages), outArt.usages);
						return [outTy, { usages: mergedUsages, vc: mergedVc }] satisfies Synthed;

						// console.log("\nSynth App Term:", EB.Display.Term(tm, ctx));
						// console.log("Function type:", NF.display(fnTy, ctx));
						// console.log("Argument type:", NF.display(argTy, ctx));
						// console.log("App Output Type:", NF.display(result[0], ctx));

						// return [out, { usages, vc }] satisfies Synthed;
					}),
				)

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
									const [ty, { usages, vc }] = yield* V2.pure(recurse(rest, [...results, artefacts]));
									const conj = Z3.And(artefacts.vc as Bool, vc as Bool);

									const quantified = quantify(current.variable, current.annotation, conj, ctx);
									return [ty, { usages, vc: quantified }] satisfies Synthed;
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

			log(`Synthesized Type:`, NF.display(ret[0], ctx));
			log(`Synthesized VC:`, ret[1].vc.sexpr().replaceAll("\n", " "));

			indentation--;
			return ret;
		});
	synth.gen = (tm: EB.Term) => V2.pure(synth(tm));

	/**
	 * Synthesize a pattern's type.
	 * Patterns synthesize to their matched type with potential refinements.
	 */
	const synthPattern = (pattern: EB.Pattern, scrutineeTy: NF.Value): V2.Elaboration<Synthed> =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();

			const r = match(pattern)
				.with({ type: "Binder" }, p => {
					// Binder pattern just inherits scrutinee type
					return [scrutineeTy, { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }] satisfies Synthed;
				})
				.with({ type: "Wildcard" }, () => {
					// Wildcard matches anything
					return [scrutineeTy, { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }] satisfies Synthed;
				})
				.with({ type: "Lit" }, p => {
					// Literal pattern creates singleton type
					const ann = match(p.value)
						.with({ type: "Atom" }, l => EB.Constructors.Lit(l))
						.with({ type: "Num" }, l => EB.Constructors.Lit({ type: "Atom", value: "Num" }))
						.with({ type: "String" }, l => EB.Constructors.Lit({ type: "Atom", value: "String" }))
						.with({ type: "Bool" }, l => EB.Constructors.Lit({ type: "Atom", value: "Bool" }))
						.with({ type: "unit" }, l => EB.Constructors.Lit({ type: "Atom", value: "Unit" }))
						.exhaustive();
					const nf = NF.evaluate(ctx, ann);

					const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
					const litTerm = EB.Constructors.Lit(p.value);
					const closure = NF.Constructors.Closure(noCapture(ctx), EB.DSL.eq(bound, litTerm));
					const fresh = freshName();
					const modalities = {
						quantity: Q.Many,
						liquid: NF.Constructors.Lambda(fresh, "Explicit", closure, nf),
					};

					return [NF.Constructors.Modal(nf, modalities), { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }] satisfies Synthed;
				})
				.with({ type: "Struct" }, { type: "Variant" }, { type: "Row" }, () => {
					// For structural patterns, just use scrutinee type
					// The meet operation will handle refinement
					return [scrutineeTy, { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }] satisfies Synthed;
				})
				.with({ type: "Var" }, p => {
					throw new Error("synthPattern: Var pattern not yet implemented");
				})
				.with({ type: "List" }, () => {
					console.warn("List pattern synthesis not yet implemented");
					return [scrutineeTy, { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }] satisfies Synthed;
				})
				.exhaustive();

			// if (r === null) {
			// 	// Handle Var pattern case with generator
			// 	const p = pattern as Extract<EB.Pattern, { type: "Var" }>;
			// 	return yield* synth.gen(p.term);
			// }

			return r;
		});
	synthPattern.gen = (pattern: EB.Pattern, scrutineeTy: NF.Value) => V2.pure(synthPattern(pattern, scrutineeTy));

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
			indentation++;
			log(`Subtyping:`, EB.Display.Env(ctx), NF.display(a, ctx, { deBruijn: true }), `<:`, NF.display(b, ctx, { deBruijn: true }));
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
				.with([NF.Patterns.Mu, NF.Patterns.Mu], ([mu1, mu2]) =>
					V2.Do(function* () {
						// Unfold both recursive types and compare their bodies
						const arg = yield* subtype.gen(mu1.binder.annotation, mu2.binder.annotation);
						const body1 = NF.apply(mu1.binder, mu1.closure, NF.Constructors.Rigid(ctx.env.length));
						const body2 = NF.apply(mu2.binder, mu2.closure, NF.Constructors.Rigid(ctx.env.length));
						const body = yield* subtype.gen(body1, body2);
						return Z3.And(arg as Bool, body as Bool);
					}),
				)
				.with([NF.Patterns.Mu, P._], ([mu, ty]) =>
					V2.Do(function* () {
						// Unfold the mu type with itself and check subtyping
						const unfolded = NF.apply(mu.binder, mu.closure, mu);
						const vc = yield* subtype.gen(unfolded, ty);
						return vc;
					}),
				)
				.with([P._, NF.Patterns.Mu], ([ty, mu]) =>
					V2.Do(function* () {
						// Unfold the mu type with itself and check subtyping
						const unfolded = NF.apply(mu.binder, mu.closure, mu);
						const vc = yield* subtype.gen(ty, unfolded);
						return vc;
					}),
				)
				.with([NF.Patterns.Schema, NF.Patterns.Sigma], ([schema, sig]) => {
					const body = NF.apply(sig.binder, sig.closure, NF.Constructors.Row(schema.arg.row));
					return subtype(schema, body);
				})
				.with([NF.Patterns.Sigma, NF.Patterns.Schema], ([sig, schema]) => {
					const body = NF.apply(sig.binder, sig.closure, NF.Constructors.Row(schema.arg.row));
					return subtype(body, schema);
				})

				.with([NF.Patterns.Schema, NF.Patterns.Schema], ([{ arg: a }, { arg: b }]) => {
					return contains(a.row, b.row);
				})
				.with([NF.Patterns.Variant, NF.Patterns.Variant], ([{ arg: a }, { arg: b }]) => {
					return contains(b.row, a.row);
				})
				.with(
					[P._, NF.Patterns.App],
					([, ty]) => O.isSome(NF.unfoldMu(ty)),
					([ty, folded]) => {
						const unfolded = NF.unfoldMu(folded);
						assert(unfolded._tag === "Some");
						return subtype(ty, unfolded.value);
					},
				)
				.with(
					[NF.Patterns.App, P._],
					([ty]) => O.isSome(NF.unfoldMu(ty)),
					([folded, ty]) => {
						const unfolded = NF.unfoldMu(folded);
						assert(unfolded._tag === "Some");
						return subtype(unfolded.value, ty);
					},
				)

				.with(
					[
						{ type: "Abs", binder: { type: "Pi" } },
						{ type: "Abs", binder: { type: "Pi" } },
					],
					([at, bt]) =>
						V2.Do(function* () {
							// 1) Ensure parameter types are in a subtype relation (contravariant)
							const vcArg = yield* subtype.gen(bt.binder.annotation, at.binder.annotation);

							// 2) Compare result types under an assumed argument x
							const ctx = yield* V2.ask();
							const lvl = ctx.env.length;
							const anf = NF.apply(at.binder, at.closure, NF.Constructors.Rigid(lvl));
							const bnf = NF.apply(bt.binder, bt.closure, NF.Constructors.Rigid(lvl));
							const vcBody = yield* V2.local(ctx => EB.bind(ctx, bt.binder, bt.binder.annotation), subtype(anf, bnf)); // covariant position

							// 3) Quantify over x and guard vcBody with the PRECONDITION for x
							const sortMap = mkSort(bt.binder.annotation, ctx);
							const xSort = match(sortMap)
								.with({ Prim: P.select() }, p => p)
								.otherwise(() => {
									throw new Error("Only primitive types can be used in logical formulas");
								});
							const x = Z3.Const(bt.binder.variable, xSort);

							// Extract and apply the liquid predicate from the supertype's argument annotation
							const modalities = extract(bt.binder.annotation, ctx);
							if (modalities.liquid.type !== "Abs") {
								throw new Error("Liquid refinement must be a unary function");
							}
							const applied = NF.apply(modalities.liquid.binder, modalities.liquid.closure, NF.Constructors.Rigid(lvl));
							const phiX = translate(applied, ctx, { [lvl]: x }) as Bool;

							// Combine: global arg-subtyping vc AND per-argument precondition => body
							const guarded = record("subtype.pi.body", Z3.ForAll([x], Z3.Implies(phiX, vcBody as Bool)) as Bool, {
								type: `${NF.display(at, ctx)} <: ${NF.display(bt, ctx)}`,
								description: `Function result must be subtype under parameter ${bt.binder.variable} assumption`,
							}) as Bool;
							// Note: vcArg may itself be a conjunction of sub-obligations; record it too for locality
							record("subtype.pi.param", vcArg as Bool, {
								type: `${NF.display(bt.binder.annotation, ctx)} <: ${NF.display(at.binder.annotation, ctx)}`,
								description: `Function parameter types (contravariant)`,
							});
							return Z3.And(vcArg as Bool, guarded as Bool);
						}),
				)

				.with([{ type: "Existential" }, P._], ([sig, ty]) =>
					V2.Do(function* () {
						const res = yield* V2.local(
							ctx => EB.bind(ctx, { type: "Pi", variable: sig.variable }, sig.annotation),
							V2.Do(function* () {
								const xtended = yield* V2.ask();

								const vc = yield* subtype.gen(sig.body.value, ty);
								return quantify(sig.variable, sig.annotation, vc, xtended);
							}),
						);
						return res;
					}),
				)

				.with([P._, { type: "Existential" }], ([ty, sig]) =>
					V2.Do(function* () {
						const r = V2.local(
							ctx => EB.bind(ctx, { type: "Pi", variable: sig.variable }, sig.annotation),
							V2.Do(function* () {
								const body = sig.body;

								// const body = NF.evaluate(xtended, abs.body);
								const vc = yield* subtype.gen(ty, body.value);
								return vc;
							}),
						);
						return yield* r;
					}),
				)

				.with([NF.Patterns.Lit, NF.Patterns.Lit], ([{ value: v1 }, { value: v2 }]) => {
					return V2.of(Z3.Bool.val(isEqual(v1, v2)));
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
						log("Subtype Modal Liquid Predicates:");
						log(EB.Display.Env(ctx));
						log("Liquid at type A:", NF.display(pAt, ctx));
						log("Liquid at type B:", NF.display(pBt, ctx));

						const appliedAt = NF.apply(pAt.binder, pAt.closure, NF.Constructors.Rigid(lvl));
						const appliedBt = NF.apply(pBt.binder, pBt.closure, NF.Constructors.Rigid(lvl));

						// log("Applied liquid at type A1:", NF.display(appliedAt, pAt.closure.ctx));
						log("Applied liquid at type A:", NF.display(appliedAt, ctx));
						// log("Applied liquid at type B1:", NF.display(appliedBt, pBt.closure.ctx));
						log("Applied liquid at type B:", NF.display(appliedBt, ctx));
						// 4) Create the Z3 quantified variable with the primitive sort of the base type
						const sortMap = mkSort(at.value, ctx);
						const xSort = match(sortMap)
							.with({ Prim: P.select() }, p => p)
							.otherwise(() => {
								log("Subtype Modal A Type:\n", NF.display(at, ctx));
								log("Subtype Modal B Type:\n", NF.display(bt, ctx));
								// log("Subtype Modal Liquid SortMap:", sortMap);
								throw new Error("Only primitive types can be used in logical formulas");
							});
						const fresh = freshName();
						const x = Z3.Const(pAt.binder.variable, xSort);

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
				.with([{ type: "Modal" }, P._], ([at, bt]) =>
					subtype(at, NF.Constructors.Modal(bt, { quantity: Q.Zero, liquid: Liquid.Predicate.NeutralNF(bt, noCapture(ctx)) })),
				)
				.with([P._, { type: "Modal" }], ([at, bt]) =>
					subtype(NF.Constructors.Modal(at, { quantity: Q.Many, liquid: Liquid.Predicate.NeutralNF(at, noCapture(ctx)) }), bt),
				)

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

			log(`Subtype Result VC:`, r.sexpr().replaceAll("\n", " ").replaceAll(/\s+/g, " "));
			indentation--;
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

					.with({ type: "Atom", value: "Unit" }, atom => Z3.Const(atom.value, Sorts.Unit))
					.with({ type: "Atom", value: "Type" }, atom => Z3.Const(atom.value, Sorts.Type))
					.with({ type: "Atom" }, atom => {
						return Z3.Const(atom.value, Sorts.Atom);
					})
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
	};

	type SortMap = { Prim: Sort } | { Func: SortMap[] } | { App: SortMap[] } | { Row: Sort } | { Recursive: Sort };
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
			.with(NF.Patterns.Sigma, _ => {
				return { Row: Sorts.Schema };
			})
			.with(NF.Patterns.Mu, mu => {
				const name = `Mu_${mu.binder.source}`;
				return { Recursive: Z3.Sort.declare(name) };
			})
			.with(NF.Patterns.Lambda, _ => {
				return { Prim: Sorts.Function };
			})
			.with({ type: "Abs" }, ({ binder, closure }) => {
				const body = NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length));
				const argSort = mkSort(binder.annotation, ctx);
				const retSort = mkSort(body, ctx);
				return { Func: [argSort, retSort] };
			})
			.with({ type: "Existential" }, ex => {
				//const argSort = mkSort(ex.annotation, ctx);
				const xtended = EB.bind(ctx, { type: "Pi", variable: ex.variable }, ex.annotation);
				return mkSort(ex.body.value, xtended);
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
				const fs = build(f);
				const as = build(a);

				//const sort = Z3.Sort.declare(`App(${fs.join(",")}, ${as.join(",")})`);
				return fs.concat(as);
			})
			.with({ Func: P.select() }, Func => {
				const [a, body] = Func;
				const as = build(a);
				const bs = build(body);
				return as.concat(bs);
			})
			.with({ Row: P.select() }, r => [r])
			.with({ Recursive: P.select() }, r => [r])
			.exhaustive();

	const quantify = (variable: string, annotation: NF.Value, vc: Expr, ctx: EB.Context): Expr => {
		return match(annotation)
			.with({ type: "Existential" }, ex => {
				const c = quantify(variable, ex.body.value, vc, EB.bind(ex.body.ctx, { type: "Pi", variable: ex.variable }, ex.annotation));
				return quantify(ex.variable, ex.annotation, c, ctx);
			})
			.with(NF.Patterns.Pi, pi => vc)
			.otherwise(() => {
				const sortMap = mkSort(annotation, ctx);
				const xSort = match(sortMap)
					.with({ Prim: P.select() }, p => p)
					.with({ Recursive: P.select() }, r => r)
					.with({ Row: P.select() }, r => r)
					.with({ App: P._ }, app => {
						const sorts = build(app);
						const name = `App_${sorts.map(s => s.name()).join("_")}`;
						return Z3.Sort.declare(name);
					})
					.otherwise(() => {
						throw new Error("Uknown sort in logical formulas");

						// console.log("Sigma Subtype SortMap:", sortMap);
					});

				if (!xSort) {
					return vc;
				}

				const x = Z3.Const(variable, xSort);

				if (annotation.type !== "Modal") {
					const forall: Bool = Z3.ForAll([x], vc as Bool);
					record(`quantify: ${variable}`, forall, {
						type: NF.display(annotation, ctx),
						description: `Quantifying over ${variable} with type ${NF.display(annotation, ctx)}`,
					});
					return forall;
				}

				const pAt = extract(annotation, ctx).liquid;

				if (pAt.type !== "Abs") {
					throw new Error("Liquid refinements must be unary functions");
				}

				const lvl = ctx.env.length;
				const appliedAt = NF.apply(pAt.binder, pAt.closure, NF.Constructors.Rigid(lvl));

				log("Quantifying liquid predicate", NF.display(appliedAt, ctx));

				const rigids = { [lvl]: x } as Record<number, Expr>;
				const phiAt = translate(appliedAt, ctx, rigids) as Bool;

				const forall: Bool = Z3.ForAll([x], Z3.Implies(phiAt, vc as Bool));
				record(`quantify: ${variable}`, forall, {
					type: NF.display(annotation, ctx),
					description: `Quantifying over ${variable}: ${NF.display(annotation, ctx)} with refinement`,
				});
				return forall;
			});
	};
	quantify.gen = (variable: string, annotation: NF.Value, vc: Expr, ctx: EB.Context) => V2.of(quantify(variable, annotation, vc, ctx));

	const collect = (r1: NF.Row, r2: NF.Row): V2.Elaboration<EB.Context["sigma"]> => {
		const res = match([r1, r2])
			.with([{ type: "empty" }, { type: "empty" }], () => V2.of<EB.Context["sigma"]>({}))
			.with([{ type: "empty" }, { type: "variable" }], () => V2.of<EB.Context["sigma"]>({}))
			.with([{ type: "extension" }, { type: "extension" }], ([{ label, value, row }, r]) =>
				V2.Do(function* () {
					const rewritten = R.rewrite(r, label);
					if (E.isLeft(rewritten)) {
						return yield* V2.fail<EB.Context["sigma"]>(Err.MissingLabel(label, r));
					}
					if (rewritten.right.type !== "extension") {
						return yield* V2.fail<EB.Context["sigma"]>({
							type: "Impossible",
							message: "Rewritting a row extension should result in another row extension",
						});
					}

					const { value: rv, row: rr } = rewritten.right;
					const acc = yield* V2.pure(collect(row, rr));
					const ctx = yield* V2.ask();
					return { ...acc, [label]: { nf: value, ann: rv, term: NF.quote(ctx, ctx.env.length, value), multiplicity: Q.Many } };
				}),
			)

			.otherwise(_ => {
				throw new Error("Schema verification: incompatible rows");
			});

		return res;
	};

	const apply = (binder: EB.Binder, closure: NF.Closure, value: NF.Value, ann: NF.Value): NF.Value => {
		const { ctx, term } = closure;
		const extended = extend(ctx, binder, value, ann);

		if (closure.type === "Closure") {
			return NF.evaluate(extended, term);
		}

		const args = extended.env.slice(0, closure.arity).map(({ nf }) => nf);
		return closure.compute(...args);
	};

	const extend = (context: EB.Context, binder: EB.Binder, value: NF.Value, ann: NF.Value): EB.Context => {
		const { env } = context;

		const entry: EB.Context["env"][number] = {
			nf: value,
			type: [binder, "source", ann],
			name: binder,
		};
		return {
			...context,
			env: [entry, ...env],
		};
	};
	const getObligations = () => obligations.slice();

	return { check, synth, subtype, getObligations };
};

const noCapture = (ctx: EB.Context) => ({ ...ctx, env: [] });
