import { match } from "ts-pattern";

import * as F from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";

import * as EB from ".";
import * as NF from "./normalization";
import * as M from "./shared/monad";

import * as Src from "@yap/src/index";
import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Log from "@yap/shared/logging";
import * as R from "@yap/shared/rows";
import * as Icit from "@yap/elaboration/implicits";

import { P } from "ts-pattern";

import { freshMeta } from "./shared/supply";
import { Subst, Substitute } from "./unification/substitution";
import { solve, displayProvenance } from "./solver";

import * as Prov from "@yap/shared/provenance";

import * as Sub from "./unification/substitution";
import _ from "lodash";

import * as Gen from "../Codegen/terms";

export type ElaboratedStmt = [EB.Statement, NF.Value, Q.Usages];
export const Stmt = {
	infer: (stmt: Src.Statement): M.Elaboration<ElaboratedStmt> => {
		return match(stmt)
			.with({ type: "let" }, letdec => {
				return F.pipe(
					M.Do,
					M.let("ctx", M.ask()),
					M.bind("ann", ({ ctx }) =>
						letdec.annotation
							? EB.check(letdec.annotation, NF.Type)
							: M.of([EB.Constructors.Var(freshMeta(ctx.env.length, NF.Type)), Q.noUsage(ctx.env.length)] as const),
					),
					M.bind("inferred", ({ ctx, ann }) => {
						const va = NF.evaluate(ctx, ann[0]);
						const q = letdec.multiplicity || Q.Many;
						const ctx_ = EB.bind(ctx, { type: "Let", variable: letdec.variable }, [va, q]);
						return M.local(
							ctx_,
							F.pipe(
								EB.check(letdec.value, va),
								M.fmap(([tm, us]): EB.AST => [tm, va, us]),
								M.discard(([, , [vu]]) => M.tell("constraint", { type: "usage", expected: q, computed: vu })),
								// remove the usage of the bound variable (same as the lambda rule)
								M.fmap(([tm, ty, [, ...us]]): EB.AST => [tm, ty, us]),
							),
						);
					}),
					M.listen(([{ inferred, ann }, { binders, constraints }]): ElaboratedStmt => {
						// TODO: This binders array is not overly useful for now
						// // In theory, all we need is to emit a flag signalling the letdec var has been used
						// FIXME: We should really leverage the `check` function to understand when to wrap in a mu
						const tm = binders.find(b => b.type === "Mu" && b.variable === letdec.variable)
							? EB.Constructors.Mu("x", letdec.variable, ann[0], inferred[0])
							: inferred[0];

						const def = EB.Constructors.Stmt.Let(letdec.variable, tm, ann[0]);
						return [def, inferred[1], inferred[2]];
					}),
				);
			})
			.with({ type: "expression" }, ({ value }) => M.fmap(infer(value), (expr): ElaboratedStmt => [EB.Constructors.Stmt.Expr(expr[0]), expr[1], expr[2]]))

			.with({ type: "using" }, ({ value }) => {
				return F.pipe(
					infer(value),
					M.fmap(([tm, ty, us]): ElaboratedStmt => [{ type: "Using", value: tm, annotation: ty }, ty, us]),
				);
			})
			.otherwise(() => {
				throw new Error("Not implemented yet");
			});
	},
};
export function infer(ast: Src.Term): M.Elaboration<EB.AST> {
	const result = M.track<EB.AST>(
		["src", ast, { action: "infer" }],

		M.chain(M.ask(), ctx => {
			return match(ast)
				.with({ type: "lit" }, ({ value }): M.Elaboration<EB.AST> => {
					const atom: Lit.Literal = match(value)
						.with({ type: "String" }, _ => Lit.Atom("String"))
						.with({ type: "Num" }, _ => Lit.Atom("Num"))
						.with({ type: "Bool" }, _ => Lit.Atom("Bool"))
						.with({ type: "unit" }, _ => Lit.Atom("Unit"))
						.with({ type: "Atom" }, _ => Lit.Atom("Type"))
						.exhaustive();

					return M.of<EB.AST>([{ type: "Lit", value }, { type: "Lit", value: atom }, Q.noUsage(ctx.env.length)]);
				})

				.with({ type: "hole" }, _ => {
					const kind = NF.Constructors.Var(freshMeta(ctx.env.length, NF.Type));
					const meta = EB.Constructors.Var(freshMeta(ctx.env.length, kind));
					const ty = NF.evaluate(ctx, meta);
					// const modal = NF.infer(env, annotation);
					return M.of<EB.AST>([meta, ty, Q.noUsage(ctx.env.length)]);
				})

				.with({ type: "var" }, ({ variable }) => EB.lookup(variable, ctx))

				.with({ type: "row" }, ({ row }) => {
					return M.local(
						EB.muContext,
						// QUESTION:? can we do anything to the ty row? Should we?
						// SOLUTION: Rely on `check` for this behaviour. Inferring a row should just returns another row, same as the struct overloaded syntax.
						M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Row(row), NF.Row, qs]),
					);
				})
				.with({ type: "struct" }, ({ row }) =>
					M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Struct(row), NF.Constructors.Schema(ty), qs]),
				)
				.with({ type: "variant" }, variant =>
					F.pipe(
						M.local(
							EB.muContext,
							F.pipe(
								EB.check(variant, NF.Type),
								M.fmap(([tm, us]): EB.AST => [tm, NF.Type, us]),
							),
						),
					),
				)
				.with({ type: "tuple" }, ({ row }) =>
					M.fmap(EB.Rows.elaborate(row), ([row, ty, us]): EB.AST => [EB.Constructors.Struct(row), NF.Constructors.Schema(ty), us]),
				)
				.with({ type: "list" }, ({ elements }) => {
					const kind = NF.Constructors.Var(freshMeta(ctx.env.length, NF.Type));
					const mvar = EB.Constructors.Var(freshMeta(ctx.env.length, kind));
					const v = NF.evaluate(ctx, mvar);

					const validate = F.flow(
						infer,
						M.discard(([, ty]) => M.tell("constraint", { type: "assign", left: ty, right: v, lvl: ctx.env.length })),
					);
					return M.fmap(M.traverse(elements, validate), (es): EB.AST => {
						const usages = es.reduce((acc, [, , us]) => Q.add(acc, us), Q.noUsage(ctx.env.length));

						const indexing = NF.Constructors.App(NF.Indexed, NF.Constructors.Lit(Lit.Atom("Num")), "Explicit");
						const values = NF.Constructors.App(indexing, v, "Explicit");

						const ty = NF.Constructors.App(values, NF.Constructors.Var({ type: "Foreign", name: "defaultHashMap" }), "Implicit");

						const tm: EB.Term = {
							type: "Row",
							row: es.reduceRight(
								(r: EB.Row, [tm], i) => {
									const label = i.toString();
									return { type: "extension", label, value: tm, row: r };
								},
								{ type: "empty" },
							),
						};

						return [tm, NF.Constructors.Neutral(ty), usages];
					});
				})
				.with({ type: "tagged" }, ({ tag, term }) =>
					M.fmap(infer(term), ([tm, ty, us]): EB.AST => {
						const rvar: NF.Row = R.Constructors.Variable(EB.freshMeta(ctx.env.length, NF.Row));
						const row: NF.Row = NF.Constructors.Extension(tag, ty, rvar);
						const variant = NF.Constructors.Variant(row);

						const trow = EB.Constructors.Extension(tag, tm, { type: "empty" });
						const tagged = EB.Constructors.Struct(trow);
						return [tagged, variant, us];
					}),
				)
				.with({ type: "dict" }, ({ index, term }) => {
					return F.pipe(
						M.Do,
						M.let("index", infer(index)),
						M.let("term", infer(term)),
						M.fmap(({ index: [tm, , us], term: [tm2, , us2] }): EB.AST => {
							const indexed = EB.Constructors.Indexed(tm, tm2);
							return [indexed, NF.Type, Q.add(us, us2)];
						}),
					);
				})
				.with({ type: "projection" }, ({ term, label }) =>
					F.pipe(
						M.Do,
						M.let("term", infer(term)),
						M.bind("inferred", ({ term: [tm, ty, us] }) => EB.Proj.project(label, tm, ty, us)),
						M.fmap(({ term: [tm, , us], inferred }): EB.AST => [EB.Constructors.Proj(label, tm), inferred, us]), // TODO: Subtract usages?
					),
				)
				.with({ type: "injection" }, ({ label, value, term }) =>
					F.pipe(
						M.Do,
						M.let("value", infer(value)),
						M.let("term", infer(term)),
						M.bind("inferred", ({ value, term }) => EB.Inj.inject(label, value, term)),
						M.fmap(({ term: [tm, , u1], value: [val, , u2], inferred }): EB.AST => [EB.Constructors.Inj(label, val, tm), inferred, Q.add(u1, u2)]),
					),
				)
				.with({ type: "annotation" }, ({ term, ann, multiplicity }) =>
					F.pipe(
						M.Do,
						M.let("ann", EB.check(ann, NF.Type)),
						M.bind("type", ({ ann: [type, us] }) => {
							const val = NF.evaluate(ctx, type);
							return M.of([val, us] as const);
						}),
						M.bind("term", ({ type: [type, us] }) => EB.check(term, type)),
						M.fmap(({ term: [term], type: [type, us] }): EB.AST => [term, type, us]),
					),
				)

				.with({ type: "application" }, EB.Application.infer)
				.with({ type: "pi" }, { type: "arrow" }, EB.Pi.infer)
				.with({ type: "lambda" }, EB.Lambda.infer)
				.with({ type: "match" }, EB.Match.infer)
				.with({ type: "block" }, ({ statements, return: ret }) => {
					const recurse = (stmts: Src.Statement[], ctx: EB.Context, results: EB.Statement[]): M.Elaboration<EB.AST> => {
						if (stmts.length === 0) {
							if (!ret) {
								//TODO: add effect tracking
								const ty = NF.Constructors.Lit(Lit.Atom("Unit"));
								const unit = EB.Constructors.Lit(Lit.Atom("unit"));
								const tm = EB.Constructors.Block(results, unit);
								return M.of<EB.AST>([tm, ty, Q.noUsage(ctx.env.length)]);
							}
							return M.local(
								ctx,
								F.pipe(
									infer(ret),
									M.fmap(([ret, ty, rus]): EB.AST => {
										return [EB.Constructors.Block(results, ret), ty, rus];
									}),
								),
							);
						}

						const [stmt, ...rest] = stmts;
						return M.local(
							ctx,
							F.pipe(
								M.Do,
								M.let("stmt", Stmt.infer(stmt)),
								M.bind("block", ({ stmt }) => {
									const [s, ty, bus] = stmt;

									if (s.type !== "Let") {
										return recurse(rest, ctx, [...results, s]);
									} // Add effect tracking here // Add effect tracking here

									const extended = EB.bind(ctx, { type: "Let", variable: s.variable }, [ty, Q.Many]);
									return F.pipe(
										recurse(rest, extended, [...results, s]),
										M.discard(([, , [vu]]) => M.tell("constraint", { type: "usage", expected: Q.Many, computed: vu })),
										//M.fmap(([tm, ty, us]): EB.AST => [tm, ty, Q.multiply(Q.Many, us)]),
										// Remove the usage of the bound variable (same as the lambda rule)
										// Multiply the usages of the let binder by the multiplicity of the new let binding (same as the application rule)
										M.fmap(([tm, ty, [vu, ...rus]]): EB.AST => [tm, ty, Q.add(rus, Q.multiply(Q.Many, bus))]),
									);
								}),
								M.fmap(({ stmt: [, , us], block: [tm, typ, usages] }) => {
									return [tm, typ, usages];
								}),
							),
						);
					};
					return recurse(statements, ctx, []);
				})
				.otherwise(v => {
					throw new Error("Not implemented yet: " + JSON.stringify(v));
				});
		}),
	);
	return result;
}

type ZonkSwitch = {
	term: EB.Term;
	nf: NF.Value;
	closure: NF.Closure;
};

export const zonk = <K extends keyof ZonkSwitch>(key: K, term: ZonkSwitch[K], subst: Subst): M.Elaboration<ZonkSwitch[K]> =>
	M.fmap(M.ask(), ctx => {
		const disp = Sub.display;
		const f = Substitute(ctx)[key];
		return f(subst, term as any, 1) as ZonkSwitch[K];
	});

export const run = (term: Src.Term, ctx: EB.Context) => {
	const elaboration = F.pipe(
		infer(term),
		M.listen(([[tm, ty], { constraints }]) => ({ inferred: { tm, ty }, constraints })),
		M.bind("sub", ({ constraints }) => solve(constraints)),
		M.bind("term", ({ sub, inferred }) => zonk("term", inferred.tm, sub)),
		M.bind("ty", ({ sub, inferred }) => zonk("nf", inferred.ty, sub)),
	);

	return M.run(elaboration, ctx);
};
