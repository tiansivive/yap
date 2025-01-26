import { match } from "ts-pattern";

import * as F from "fp-ts/lib/function";

import * as EB from ".";
import * as NF from "./normalization";
import * as M from "./monad";

import * as Src from "@qtt/src/index";
import * as Lit from "@qtt/shared/literals";
import * as Q from "@qtt/shared/modalities/multiplicity";
import { mkLogger } from "@qtt/shared/logging";

import { P } from "ts-pattern";
import { print as srcPrint } from "../parser/pretty";
import { displayConstraint, displayContext } from "./pretty";

import { freshMeta } from "./supply";

export type Constraint = { type: "assign"; left: NF.Value; right: NF.Value } | { type: "usage"; computed: Q.Multiplicity; expected: Q.Multiplicity };

let count = 0;
const { log } = mkLogger();

export function infer(ast: Src.Term): M.Elaboration<EB.AST> {
	const result = F.pipe(
		M.ask(),
		M.chain(ctx => {
			log("entry", "Infer", { Context: displayContext(ctx), AST: srcPrint(ast) });
			const { env } = ctx;
			return match(ast)
				.with({ type: "lit" }, ({ value }): M.Elaboration<EB.AST> => {
					const atom: Lit.Literal = match(value)
						.with({ type: "String" }, _ => Lit.Atom("String"))
						.with({ type: "Num" }, _ => Lit.Atom("Num"))
						.with({ type: "Bool" }, _ => Lit.Atom("Bool"))
						.with({ type: "Atom" }, _ => Lit.Atom("Type"))
						.exhaustive();

					return M.of<EB.AST>([{ type: "Lit", value }, { type: "Lit", value: atom }, Q.noUsage(ctx.env.length)]);
				})

				.with({ type: "hole" }, _ => {
					const meta = EB.Constructors.Var(freshMeta());
					const ty = NF.evaluate(env, ctx.imports, meta);
					// const modal = NF.infer(env, annotation);
					return M.of<EB.AST>([meta, ty, Q.noUsage(ctx.env.length)]);
				})

				.with({ type: "var" }, ({ variable }): M.Elaboration<EB.AST> => M.of<EB.AST>(EB.lookup(variable, ctx)))
				.with({ type: "annotation" }, ({ term, ann, multiplicity }) =>
					F.pipe(
						M.Do,
						M.bind("ann", _ => check(ann, NF.Type)),
						M.bind("type", ({ ann: [type, us] }) => {
							const val = NF.evaluate(env, ctx.imports, type);
							//const mval = NF.infer(env, val);
							return M.of([val, us] as const);
						}),
						M.bind("term", ({ type: [type, us] }) => check(term, type)),
						M.fmap(({ term: [term], type: [type, us] }): EB.AST => [term, type, us]),
					),
				)

				.with({ type: "application" }, ({ fn, arg, icit }) =>
					F.pipe(
						M.Do,
						M.bind("fn", () => M.chain(infer(fn), icit === "Explicit" ? insertImplicitApps : M.of)),

						M.bind("pi", ({ fn: [ft, fty] }) =>
							match(fty)
								.with({ type: "Abs", binder: { type: "Pi" } }, pi => {
									if (pi.binder.icit !== icit) {
										throw new Error("Implicitness mismatch");
									}

									return M.of([pi.binder.annotation, pi.closure] as const);
								})
								.otherwise(() => {
									const meta = EB.Constructors.Var(freshMeta());
									const nf = NF.evaluate(env, ctx.imports, meta);
									const mnf: NF.ModalValue = [nf, Q.Many];
									const closure = NF.Closure(env, EB.Constructors.Var(freshMeta()));

									const pi = NF.Constructors.Pi("x", icit, mnf, closure);

									return F.pipe(
										M.of([mnf, closure] as const),
										M.discard(() => M.tell({ type: "assign", left: fty, right: pi })),
									);
								}),
						),
						M.bind("arg", ({ pi: [ann] }) => M.local(ctx, check(arg, ann[0]))),
						M.chain(({ fn: [ft, fty, fus], arg: [at, aus], pi }) => {
							const [[, q], cls] = pi;
							const rus = Q.add(fus, Q.multiply(q, aus));

							const val = NF.apply(ctx.imports, cls, NF.evaluate(env, ctx.imports, at), q);

							const ast: EB.AST = [EB.Constructors.App(icit, ft, at), val, rus];
							return M.of(ast);
						}),
					),
				)

				.with({ type: "pi" }, { type: "arrow" }, (pi): M.Elaboration<EB.AST> => {
					const v = pi.type === "pi" ? pi.variable : `t${++count}`;
					const body = pi.type === "pi" ? pi.body : pi.rhs;
					const ann = pi.type === "pi" ? pi.annotation : pi.lhs;
					const q = pi.type === "pi" && pi.multiplicity ? pi.multiplicity : Q.Many;

					return F.pipe(
						M.Do,
						M.bind("ann", () => check(ann, NF.Type)),
						M.bind("body", ({ ann: [ann] }) => {
							const va = NF.evaluate(env, ctx.imports, ann);
							const mva: NF.ModalValue = [va, q];
							const ctx_ = EB.bind(ctx, v, mva);
							return M.local(ctx_, check(body, NF.Type));
						}),
						M.fmap(({ ann: [ann, aus], body: [body, [, ...busTail]] }) => [EB.Constructors.Pi(v, pi.icit, q, ann, body), NF.Type, Q.add(aus, busTail)]),
					);
				})
				.with({ type: "lambda" }, (lam): M.Elaboration<EB.AST> => {
					const meta: EB.Term = EB.Constructors.Var(freshMeta());
					const ann = lam.annotation ? check(lam.annotation, NF.Type) : M.of<[EB.Term, Q.Usages]>([meta, Q.noUsage(ctx.env.length)]);
					return M.chain(ann, ([tm]) => {
						const va = NF.evaluate(env, ctx.imports, tm);
						const mva: NF.ModalValue = [va, lam.multiplicity ? lam.multiplicity : Q.Many];
						const ctx_ = EB.bind(ctx, lam.variable, mva);
						return M.local(
							ctx_,
							F.pipe(
								infer(lam.body),
								M.chain(insertImplicitApps),
								M.discard(([, , [vu]]) => M.tell({ type: "usage", expected: mva[1], computed: vu })),
								M.fmap(([bTerm, bType, [vu, ...us]]): EB.AST => {
									const tm = EB.Constructors.Lambda(lam.variable, lam.icit, bTerm);
									const pi = NF.Constructors.Pi(lam.variable, lam.icit, mva, NF.closeVal(ctx, bType));

									return [tm, pi, us]; // Remove the usage M.of the bound variable
								}),
							),
						);
					});
				})

				.with({ type: "struct" }, ({ row }) => {
					// const ty = NF.Constructors.App(
					// 	EB.Constructors.Lit(Shared.Atom("Struct")),

					// );
					return 1 as any;
				})
				.otherwise(() => {
					throw new Error("Not implemented yet");
				});
		}),
		M.discard(([tm, ty, us]) => {
			log("exit", "Result", { Term: EB.display(tm), Type: NF.display(ty), Usages: us });
			return M.of(null);
		}),
	);
	return result;
}

function check(term: Src.Term, type: NF.Value): M.Elaboration<[EB.Term, Q.Usages]> {
	return F.pipe(
		M.ask(),
		M.chain(ctx => {
			log("entry", "Check", { Term: srcPrint(term), Annotation: NF.display(type) });
			return match([term, type])
				.with(
					[{ type: "lambda" }, { type: "Abs", binder: { type: "Pi" } }],
					([tm, ty]) => tm.icit === ty.binder.icit,
					([tm, ty]) => {
						const bType = NF.apply(ctx.imports, ty.closure, NF.Constructors.Rigid(ctx.env.length));

						const ctx_ = EB.bind(ctx, tm.variable, ty.binder.annotation);
						return M.local(
							ctx_,
							F.pipe(
								check(tm.body, bType),
								M.discard(([, [vu]]) => M.tell({ type: "usage", expected: ty.binder.annotation[1], computed: vu })),
								M.fmap(([body, [, ...us]]): [EB.Term, Q.Usages] => [EB.Constructors.Lambda(tm.variable, tm.icit, body), us]),
							),
						);
					},
				)
				.with(
					[P._, { type: "Abs", binder: { type: "Pi" } }],
					([_, ty]) => ty.binder.icit === "Implicit",
					([tm, ty]) => {
						const bType = NF.apply(ctx.imports, ty.closure, NF.Constructors.Rigid(ctx.env.length));
						const ctx_ = EB.bindInsertedImplicit(ctx, ty.binder.variable, ty.binder.annotation);
						return M.local(
							ctx_,
							F.pipe(
								check(tm, bType),
								M.discard(([, [vu]]) => M.tell({ type: "usage", expected: ty.binder.annotation[1], computed: vu })),
								M.fmap(([tm, [, ...us]]): [EB.Term, Q.Usages] => [EB.Constructors.Lambda(ty.binder.variable, "Implicit", tm), us]),
							),
						);
					},
				)
				.with([{ type: "hole" }, P._], () => M.of<[EB.Term, Q.Usages]>([EB.Constructors.Var(freshMeta()), []]))
				.otherwise(([tm, _]) =>
					F.pipe(
						infer(tm),
						M.chain(insertImplicitApps),
						M.discard(([, inferred]) => M.tell({ type: "assign", left: inferred, right: type })),
						M.fmap(([tm, , us]): [EB.Term, Q.Usages] => [tm, us]),
					),
				);
		}),
		M.listen(([[tm, us], cs]) => {
			log("exit", "Result", { Term: EB.display(tm), Usages: us, Constraints: cs.map(displayConstraint) });
			return [tm, us];
		}),
	);
}

function insertImplicitApps(node: EB.AST): M.Elaboration<EB.AST> {
	const [term, ty, us] = node;
	return F.pipe(
		M.ask(),
		M.chain(ctx => {
			log("entry", "Insert", { Term: EB.display(term), Type: NF.display(ty) });
			return match(node)
				.with([{ type: "Abs", binding: { type: "Lambda", icit: "Implicit" } }, P._, P._], () => M.of<EB.AST>(node))
				.with([P._, { type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, P._], ([, pi]) => {
					const meta = EB.Constructors.Var(freshMeta());
					const vNF = NF.evaluate(ctx.env, ctx.imports, meta);

					const tm = EB.Constructors.App("Implicit", term, meta);

					const bodyNF = NF.apply(ctx.imports, pi.closure, vNF);

					return insertImplicitApps([tm, bodyNF, us]);
				})
				.otherwise(() => M.of(node));
		}),
		M.discard(([tm, ty]) => {
			log("exit", "Result", { Term: EB.display(tm), Type: NF.display(ty) });
			return M.of(null);
		}),
	);
}
