import { match } from "ts-pattern";

import * as F from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";

import * as EB from ".";
import * as NF from "./normalization";
import * as M from "./monad";

import * as Src from "@qtt/src/index";
import * as Lit from "@qtt/shared/literals";
import * as Q from "@qtt/shared/modalities/multiplicity";
import * as Log from "@qtt/shared/logging";
import * as R from "@qtt/shared/rows";
import * as Icit from "@qtt/elaboration/implicits";

import { P } from "ts-pattern";

import { freshMeta } from "./supply";
import { Subst, Substitute } from "./substitution";
import { solve, displayProvenance } from "./solver";

import * as Prov from "@qtt/shared/provenance";

import * as Sub from "./substitution";
import _ from "lodash";

import * as Gen from "../codegen";

export type Constraint =
	| { type: "assign"; left: NF.Value; right: NF.Value; lvl: number }
	| { type: "usage"; computed: Q.Multiplicity; expected: Q.Multiplicity }
	| { type: "resolve"; meta: Extract<EB.Variable, { type: "Meta" }>; annotation: NF.Value };

export type ElaboratedStmt = [EB.Statement, NF.Value, Q.Usages];
export const Stmt = {
	infer: (stmt: Src.Statement): M.Elaboration<ElaboratedStmt> => {
		Log.push("stmt");
		Log.logger.debug(Src.Stmt.display(stmt));
		return match(stmt)
			.with({ type: "let" }, letdec => {
				return F.pipe(
					M.Do,
					M.let("ctx", M.ask()),
					M.bind("ann", ({ ctx }) =>
						letdec.annotation ? check(letdec.annotation, NF.Type) : M.of([EB.Constructors.Var(freshMeta(ctx.env.length)), Q.noUsage(ctx.env.length)] as const),
					),
					M.bind("inferred", ({ ctx, ann }) => {
						const va = NF.evaluate(ctx.env, ctx.imports, ann[0]);
						const q = letdec.multiplicity || Q.Many;
						const ctx_ = EB.bind(ctx, { type: "Let", variable: letdec.variable }, [va, q]);
						return M.local(
							ctx_,
							F.pipe(
								// infer(letdec.value),
								// M.discard(inferred => M.tell("constraint", { type: "assign", left: va, right: inferred[1], lvl: ctx_.env.length })),
								check(letdec.value, va),
								M.fmap(([tm, us]): [EB.Term, NF.Value, Q.Usages] => [tm, va, us]),
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
						// const def = EB.Constructors.Stmt.Let(letdec.variable, inferred[0], ann[0]);
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
		F.pipe(
			M.chain(M.ask(), ctx => {
				Log.push("infer");
				Log.logger.debug(Src.display(ast), { Context: EB.Display.Context(ctx) });
				const { env } = ctx;
				return match(ast)
					.with({ type: "lit" }, ({ value }): M.Elaboration<EB.AST> => {
						const atom: Lit.Literal = match(value)
							.with({ type: "String" }, _ => Lit.Atom("String"))
							.with({ type: "Num" }, _ => Lit.Atom("Num"))
							.with({ type: "Bool" }, _ => Lit.Atom("Bool"))
							.with({ type: "unit" }, _ => Lit.Atom("Unit"))
							.with({ type: "Atom" }, _ => Lit.Atom("Type"))
							.exhaustive();

						const tm = EB.Constructors.Lit(atom);
						const traced = Prov.provide(tm, [["src", ast]], ast.location);

						return M.of<EB.AST>([{ type: "Lit", value }, { type: "Lit", value: atom }, Q.noUsage(ctx.env.length)]);
					})

					.with({ type: "hole" }, _ => {
						const meta = EB.Constructors.Var(freshMeta(env.length));
						const ty = NF.evaluate(env, ctx.imports, meta);
						// const modal = NF.infer(env, annotation);
						return M.of<EB.AST>([meta, ty, Q.noUsage(ctx.env.length)]);
					})

					.with({ type: "var" }, ({ variable }) => EB.lookup(variable, ctx))

					.with({ type: "row" }, ({ row }) =>
						M.local(
							EB.muContext,
							// QUESTION:? can we do anything to the ty row? Should we?
							M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Row(row), NF.Row, qs]),
						),
					)
					.with({ type: "struct" }, ({ row }) =>
						M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Struct(row), NF.Constructors.Schema(ty), qs]),
					)
					.with({ type: "schema" }, ({ row }) =>
						F.pipe(
							M.local(
								EB.muContext,
								M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Schema(row), NF.Type, qs]),
							),
							// insertMu
						),
					)

					.with({ type: "variant" }, variant =>
						F.pipe(
							M.local(
								EB.muContext,
								F.pipe(
									check(variant, NF.Type),
									M.fmap(([tm, us]): EB.AST => [tm, NF.Type, us]),
								),
							),
							// insertMu
						),
					)
					.with({ type: "tuple" }, ({ row }) =>
						// M.fmap(EB.Rows.elaborate(row), ([row, ty, us]): EB.AST => {
						// 	const meta = freshMeta();

						// 	return [
						// 		EB.Constructors.App("Explicit", EB.Constructors.Var(meta), EB.Constructors.Row(row)),
						// 		NF.Constructors.App(NF.Constructors.Flex(meta), NF.Constructors.Row(ty), "Explicit"),
						// 		us
						// 	]
						// }),
						M.fmap(EB.Rows.elaborate(row), ([row, ty, us]): EB.AST => [EB.Constructors.Struct(row), NF.Constructors.Schema(ty), us]),
					)
					.with({ type: "tagged" }, ({ tag, term }) =>
						M.fmap(infer(term), ([tm, ty, us]): EB.AST => {
							const rvar: NF.Row = R.Constructors.Variable(EB.freshMeta(ctx.env.length));
							const row: NF.Row = NF.Constructors.Extension(tag, ty, rvar);
							const variant = NF.Constructors.Variant(row);

							const trow = EB.Constructors.Extension(tag, tm, { type: "empty" });
							const tagged = EB.Constructors.Struct(trow);
							return [tagged, variant, us];
						}),
					)
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
							M.let("ann", check(ann, NF.Type)),
							M.bind("type", ({ ann: [type, us] }) => {
								const val = NF.evaluate(env, ctx.imports, type);
								return M.of([val, us] as const);
							}),
							M.bind("term", ({ type: [type, us] }) => check(term, type)),
							M.fmap(({ term: [term], type: [type, us] }): EB.AST => [term, type, us]),
						),
					)

					.with({ type: "application" }, EB.Application.infer)
					.with({ type: "pi" }, { type: "arrow" }, EB.Pi.infer)
					.with({ type: "lambda" }, EB.Lambda.infer)
					.with({ type: "match" }, EB.Match.infer)
					.with({ type: "block" }, ({ statements, return: ret }) =>
						F.pipe(
							M.fold<Src.Statement, [ElaboratedStmt[], Q.Usages, EB.Context]>(
								([stmts, us, ctx], stmt) => {
									return M.local(
										ctx,
										F.pipe(
											Stmt.infer(stmt),
											// TODO: When adding effect tracking, we need to add the current effect to the row
											M.fmap((stmt): [ElaboratedStmt[], Q.Usages, EB.Context] => {
												const current = stmt[0];

												const _ctx = current.type === "Let" ? EB.bind(ctx, { type: "Let", variable: current.variable }, [stmt[1], Q.Many]) : ctx;

												return [[...stmts, stmt], Q.add(stmt[2], us), _ctx]; // add usages for each statement
											}),
										),
									);
								},
								[[], Q.noUsage(ctx.env.length), ctx],
								statements,
							),
							M.chain(([stmts, us, blockCtx]) => {
								if (!ret) {
									//TODO: add effect tracking
									const ty = NF.Constructors.Lit(Lit.Atom("Unit"));
									const unit = EB.Constructors.Lit(Lit.Atom("unit"));
									const tm = EB.Constructors.Block(
										stmts.map(([stmt]) => stmt),
										unit,
									);
									return M.of<EB.AST>([tm, ty, us]);
								}

								return M.local(
									blockCtx,
									F.pipe(
										infer(ret),
										M.fmap(([ret, ty, rus]): EB.AST => {
											const stmts_ = stmts.map(([stmt]) => stmt);
											return [EB.Constructors.Block(stmts_, ret), ty, Q.add(us, rus)];
										}),
										// remove all usages from variables bound in the block
										M.fmap(([tm, ty, bus]): EB.AST => {
											// Sanity check
											if (blockCtx.env.length < ctx.env.length) {
												throw new Error("Block context is not a subset of the current context");
											}

											const us = bus.slice(blockCtx.env.length - ctx.env.length);
											return [tm, ty, us];
										}),
									),
								);
							}),
						),
					)
					.otherwise(v => {
						throw new Error("Not implemented yet: " + JSON.stringify(v));
					});
			}),
			M.discard(([tm, ty, us]) => {
				Log.logger.debug("[Result] " + NF.display(ty), { Term: EB.Display.Term(tm), Type: NF.display(ty), Usages: us });
				Log.pop();
				return M.of(null);
			}),
		),
	);
	return result;
}

export function check(term: Src.Term, type: NF.Value): M.Elaboration<[EB.Term, Q.Usages]> {
	return M.track(
		["src", term, { action: "checking", against: type }],
		F.pipe(
			M.chain(M.ask(), ctx => {
				Log.push("check");
				Log.logger.debug("Checking", { Context: EB.Display.Context(ctx) });
				Log.logger.debug(Src.display(term));
				Log.logger.debug(NF.display(type));

				return match([term, type])
					.with([{ type: "hole" }, P._], () => M.of<[EB.Term, Q.Usages]>([EB.Constructors.Var(freshMeta(ctx.env.length)), []]))
					.with(
						[{ type: "lambda" }, { type: "Abs", binder: { type: "Pi" } }],
						([tm, ty]) => tm.icit === ty.binder.icit,
						([tm, ty]) => {
							const bType = NF.apply(ctx.imports, ty.closure, NF.Constructors.Rigid(ctx.env.length));

							const ctx_ = EB.bind(ctx, { type: "Lambda", variable: tm.variable }, ty.binder.annotation);
							return M.local(
								ctx_,
								F.pipe(
									check(tm.body, bType),
									M.discard(([, [vu]]) => M.tell("constraint", { type: "usage", expected: ty.binder.annotation[1], computed: vu })),
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
							const ctx_ = EB.bind(ctx, { type: "Lambda", variable: ty.binder.variable }, ty.binder.annotation, "inserted");
							return M.local(
								ctx_,
								F.pipe(
									check(tm, bType),
									M.discard(([, [vu]]) => M.tell("constraint", { type: "usage", expected: ty.binder.annotation[1], computed: vu })),
									M.fmap(([tm, [, ...us]]): [EB.Term, Q.Usages] => [EB.Constructors.Lambda(ty.binder.variable, "Implicit", tm), us]),
								),
							);
						},
					)
					.with([{ type: "variant" }, NF.Patterns.Type], ([{ row }, ty]) => {
						return M.fmap(traverseR(row), (r): [EB.Term, Q.Usages] => [EB.Constructors.Variant(r), Q.noUsage(ctx.env.length)]);
						//M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Variant(row), NF.Type, qs]),
					})
					.with([{ type: "tuple" }, NF.Patterns.Type], ([{ row }, ty]) => {
						return M.fmap(traverseR(row), (r): [EB.Term, Q.Usages] => [EB.Constructors.Schema(r), Q.noUsage(ctx.env.length)]);
					})
					.with([{ type: "struct" }, NF.Patterns.Type], ([{ row }, ty]) => {
						return M.fmap(traverseR(row), (r): [EB.Term, Q.Usages] => [EB.Constructors.Schema(r), Q.noUsage(ctx.env.length)]);
					})
					.otherwise(([tm, ty]) => {
						return M.local(
							_.isEqual(ty, NF.Type) ? EB.muContext : ctx,
							F.pipe(
								infer(tm),
								M.chain(EB.Icit.insert),
								M.discard(([, inferred]) => M.tell("constraint", { type: "assign", left: inferred, right: type, lvl: ctx.env.length })),
								M.fmap(([tm, , us]): [EB.Term, Q.Usages] => [tm, us]),
							),
						);
					});
			}),
			M.listen(([[tm, us], { constraints }]) => {
				Log.logger.debug("[Result] " + EB.Display.Term(tm), { Usages: us, Constraints: constraints.map(EB.Display.Constraint) });
				Log.pop();

				return [tm, us];
			}),
		),
	);
}

const traverseR = (row: Src.Row): M.Elaboration<EB.Row> => {
	return match(row)
		.with({ type: "empty" }, () => M.of<EB.Row>({ type: "empty" }))
		.with({ type: "extension" }, ({ label, value, row }) =>
			F.pipe(
				M.Do,
				M.let("value", check(value, NF.Type)),
				M.let("row", traverseR(row as Src.Row)),
				M.fmap(({ value: [val, _], row }) => {
					const r = R.Constructors.Extension(label, val, row);
					return r;
				}),
			),
		)
		.with({ type: "variable" }, ({ variable }) => {
			throw new Error("Checking variant row variable against Type: Not implemented yet");
		})
		.exhaustive();
};

// const insertMu = M.chain<EB.AST, EB.AST>(ast => {
// 	return M.fmap(M.ask(), (ctx): EB.AST => {
// 		const [tm, ty, us] = ast;

// 		const letdecs = ctx.types.filter(([b]) => b.type === "Let");

// 		const wrapped = letdecs.reduce((t, [, , [nf]]) => {
// 			// const m = EB.freshMeta(ctx.env.length);
// 			const ann = NF.quote(ctx.imports, ctx.env.length, nf);
// 			const mu = EB.Constructors.Mu("x", ann, t);
// 			return mu;
// 		}, tm);

// 		return [wrapped, ty, us];
// 	});
// });

// 	M.listen<EB.AST, EB.AST>(([ast, { binders }]): EB.AST => {
// 	// TODO: This binders array is not overly useful for now
// 	// In theory, all we need is to emit a flag signalling the letdec var has been used
// 	const ann = EB.Constructors.Var(EB.freshMeta(ctx.env.length))
// 	const ty = EB.Constructors.Lit(Lit.Atom("Type"))
// 	const tm = binders.find(b => b.type === "Mu") ? EB.Constructors.Mu("x", ty, ast[0]) : ast[0];

// 	return [tm, ast[1], ast[2]];
// });

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

export const script = ({ script }: Src.Script, startCtx: EB.Context) => {
	const next = (
		stmts: Src.Statement[],
		acc: {
			ctx: EB.Context;
			results: E.Either<[string, M.Err], ElaboratedStmt>[];
		},
	) => {
		if (stmts.length === 0) {
			return acc;
		}

		const [current, ...rest] = stmts;

		if (current.type === "expression") {
			console.warn("Expression statements are not supported yet");
			return next(rest, acc);
		}

		if (current.type === "foreign") {
			const [result] = M.run(check(current.annotation, NF.Type), acc.ctx);
			const updated = F.pipe(
				result,
				E.match(
					err => {
						console.log(displayProvenance(err.provenance));
						return { ...acc, results: [...acc.results, E.left<[string, M.Err], ElaboratedStmt>([current.variable, err])] };
					},
					([tm, us]) => {
						const metas = Icit.metas(tm);
						if (metas.length > 0) {
							throw new Error("Foreign functions cannot have unknown terms");
						}

						const nf = NF.evaluate(acc.ctx.env, acc.ctx.imports, tm);
						const v = EB.Constructors.Var({ type: "Foreign", name: current.variable });
						const ctx_: EB.Context = { ...acc.ctx, imports: { ...acc.ctx.imports, [current.variable]: [v, nf, us] } };
						return { ...acc, ctx: ctx_ };
					},
				),
			);
			return next(rest, updated);
		}

		if (current.type === "using") {
			const [result] = M.run(Stmt.infer(current), acc.ctx);
			const updated = F.pipe(
				result,
				E.match(
					err => {
						console.log(displayProvenance(err.provenance));
						return acc;
					},
					([tm, ty]) => {
						const ctx_: EB.Context = { ...acc.ctx, implicits: [...acc.ctx.implicits, [tm.value, ty]] };
						return { ...acc, ctx: ctx_ };
					},
				),
			);
			return next(rest, updated);
		}

		const action = F.pipe(
			Stmt.infer(current),
			M.listen(([[stmt, ty, us], { constraints }]) => {
				//console.log("[ DEBUG ]\n", displayProvenance(constraints[11].provenance));
				return { inferred: { stmt, ty, us }, constraints };
			}),
			M.bind("sub", ({ constraints }) => {
				// constraints.forEach(c => console.log("[ DEBUG ] " + EB.Display.Constraint(c)));
				return M.fmap(solve(constraints), s => {
					// console.log("[ DEBUG ]\n" + Sub.display(s));
					return s;
				});
			}),
			M.bind("ty", ({ sub, inferred }) =>
				F.pipe(
					zonk("nf", inferred.ty, sub),
					M.fmap(nf => {
						return NF.generalize(nf, acc.ctx);
					}),
				),
			),
			M.bind("term", ({ sub, inferred }) => {
				return F.pipe(zonk("term", inferred.stmt.value, sub), M.fmap(EB.Icit.generalize));
			}),
		);

		const [result] = M.run(action, acc.ctx);
		const updated = F.pipe(
			result,
			E.match(
				err => {
					// markResolved("dummy.lama", stmt.variable, E.left(err));
					console.log(displayProvenance(err.provenance));
					return { ...acc, results: [...acc.results, E.left<[string, M.Err], ElaboratedStmt>([current.variable, err])] };
				},
				({ term, ty, inferred }) => {
					const ctx_: EB.Context = { ...acc.ctx, imports: { ...acc.ctx.imports, [current.variable]: [term, ty, inferred.us] } };
					const letdec = EB.Constructors.Stmt.Let(current.variable, term, NF.quote(acc.ctx.imports, 0, ty));
					// markResolved("dummy.lama", stmt.variable, E.right([letdec.value, inferred.ty, inferred.us]));
					return { ctx: ctx_, results: [...acc.results, E.right<[string, M.Err], ElaboratedStmt>([letdec, inferred.ty, inferred.us])] };
				},
			),
		);
		return next(rest, updated);
	};

	const letdecs = next(script, { ctx: startCtx, results: [] as E.Either<[string, M.Err], ElaboratedStmt>[] });

	return letdecs.results;
};
