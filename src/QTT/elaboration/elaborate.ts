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

import { displayConstraint, displayContext } from "./pretty";

import { freshMeta } from "./supply";

export type Constraint = { type: "assign"; left: NF.Value; right: NF.Value } | { type: "usage"; computed: Q.Multiplicity; expected: Q.Multiplicity };

let count = 0;
export const resetCount = () => {
	count = 0;
};

const { log } = mkLogger();

export function infer(ast: Src.Term): M.Elaboration<EB.AST> {
	const result = F.pipe(
		M.ask(),
		M.chain(ctx => {
			log("entry", "Infer", { Context: displayContext(ctx), AST: Src.display(ast) });
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

				.with({ type: "var" }, ({ variable }) => M.of<EB.AST>(EB.lookup(variable, ctx)))

				.with({ type: "row" }, ({ row }) =>
					F.pipe(
						elaborate(row),
						M.fmap(([row, ty, qs]): EB.AST => [EB.Constructors.Row(row), NF.Row, qs]), // QUESTION:? can we do anything to the ty row? Should we?
					),
				)
				.with({ type: "struct" }, ({ row }) => M.fmap(elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Struct(row), NF.Constructors.Schema(ty), qs]))
				.with({ type: "schema" }, ({ row }) => M.fmap(elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Schema(row), NF.Type, qs]))

				.with({ type: "variant" }, ({ row }) =>
					M.fmap(elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Variant(row), NF.Constructors.Variant(ty), qs]),
				)

				.with({ type: "projection" }, ({ term, label }) =>
					F.pipe(
						M.Do,
						M.let("term", infer(term)),
						M.bind("inferred", ({ term: [tm, ty, us] }) => project(label, tm, ty, us)),
						M.fmap(({ term: [tm, , us], inferred }): EB.AST => [EB.Constructors.Proj(label, tm), inferred, us]), // TODO: Subtract usages?
					),
				)
				.with({ type: "injection" }, ({ label, value, term }) =>
					F.pipe(
						M.Do,
						M.let("value", infer(value)),
						M.let("term", infer(term)),
						M.bind("inferred", ({ value, term }) => inject(label, value, term)),
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

				.with({ type: "application" }, ({ fn, arg, icit }) =>
					F.pipe(
						M.Do,
						M.let("fn", M.chain(infer(fn), icit === "Explicit" ? insertImplicitApps : M.of)),
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
									const closure = NF.Constructors.Closure(env, EB.Constructors.Var(freshMeta()));

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
						M.let("ann", check(ann, NF.Type)),
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
					const meta = EB.Constructors.Var(freshMeta());
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

				.with({ type: "match" }, EB.Match.infer)
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
			log("entry", "Check", { Term: Src.display(term), Annotation: NF.display(type) });
			return (
				match([term, type])
					.with([{ type: "hole" }, P._], () => M.of<[EB.Term, Q.Usages]>([EB.Constructors.Var(freshMeta()), []]))
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
					// .with([{ type: "row" }, NF.Patterns.Type], ([{ row }, k]) => {

					// 	const res = elaborate(row);

					// 	return 1 as any
					// })

					.otherwise(([tm, _]) =>
						F.pipe(
							infer(tm),
							M.chain(insertImplicitApps),
							M.discard(([, inferred]) => M.tell({ type: "assign", left: inferred, right: type })),
							M.fmap(([tm, , us]): [EB.Term, Q.Usages] => [tm, us]),
						),
					)
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

const elaborate = (row: Src.Row): M.Elaboration<[EB.Row, NF.Row, Q.Usages]> =>
	M.chain(M.ask(), ctx =>
		match(row)
			.with({ type: "empty" }, r => M.of<[EB.Row, NF.Row, Q.Usages]>([r, { type: "empty" }, Q.noUsage(ctx.env.length)]))
			.with({ type: "variable" }, ({ variable }) => {
				const [tm, ty, qs] = EB.lookup(variable, ctx);
				if (tm.type !== "Var") {
					throw new Error("Elaborating Row Var: Not a variable");
				}

				const _ty = NF.unwrapNeutral(ty);
				if (_ty.type !== "Row" && _ty.type !== "Var") {
					throw new Error("Elaborating Row Var: Type not a row or var");
				}

				const ast: [EB.Row, NF.Row, Q.Usages] = [
					{ type: "variable", variable: tm.variable },
					_ty.type === "Row" ? _ty.row : { type: "variable", variable: _ty.variable },
					qs,
				];
				return F.pipe(
					M.of(ast),
					M.discard(_ => M.tell({ type: "assign", left: _ty, right: NF.Row })),
				);
			})
			.with({ type: "extension" }, ({ label, value, row }) =>
				F.pipe(
					M.Do,
					M.bind("value", () => infer(value)),
					M.bind("row", () => elaborate(row)),
					M.fmap(({ value, row }): [EB.Row, NF.Row, Q.Usages] => {
						const q = Q.add(value[2], row[2]);
						const ty = NF.Constructors.Extension(label, value[1], row[1]);
						const tm = EB.Constructors.Extension(label, value[0], row[0]);
						return [tm, ty, q];
					}),
				),
			)
			.exhaustive(),
	);

const kindOf = (ty: NF.Value): M.Elaboration<NF.Value> =>
	match(ty)
		.with({ type: "Neutral" }, ({ value }) => kindOf(value))
		.with({ type: "Row" }, _ => M.of(NF.Row))
		.with({ type: "Var" }, ({ variable }) =>
			M.chain(M.ask(), ctx =>
				match(variable)
					.with({ type: "Free" }, ({ name }) => {
						const val = ctx.imports[name];

						if (!val) {
							throw new Error("Unbound free variable: " + name);
						}

						return kindOf(NF.evaluate(ctx.env, ctx.imports, val[0]));
					})
					.with({ type: "Meta" }, _ => M.of(NF.Constructors.Var(freshMeta())))
					.with({ type: "Bound" }, ({ index }) => M.of(ctx.env[index][0]))
					.exhaustive(),
			),
		)
		.otherwise(() => M.of(NF.Type));

const project = (label: string, tm: EB.Term, ty: NF.Value, us: Q.Usages): M.Elaboration<NF.Value> =>
	M.chain(M.ask(), ctx =>
		match(ty)
			.with({ type: "Neutral" }, ({ value }) => project(label, tm, value, us))
			.with({ type: "Var" }, _ => {
				const r: NF.Row = { type: "variable", variable: freshMeta() };
				const ctor = NF.evaluate(ctx.env, ctx.imports, EB.Constructors.Var(freshMeta()));
				const val = NF.evaluate(ctx.env, ctx.imports, EB.Constructors.Var(freshMeta()));

				const inferred = NF.Constructors.App(ctor, { type: "Row", row: NF.Constructors.Extension(label, val, r) }, "Explicit");

				return M.fmap(M.tell({ type: "assign", left: inferred, right: ty }), () => inferred);
			})
			.with(
				NF.Patterns.Schema,
				({
					func: {
						value: { value },
					},
				}) => value === "Schema" || value === "Variant",
				({ func, arg }) => {
					const from = (l: string, row: NF.Row): [NF.Row, NF.Value] =>
						match(row)
							.with({ type: "empty" }, _ => {
								throw new Error("Label not found: " + l);
							})
							.with(
								{ type: "extension" },
								({ label: l_ }) => l === l_,
								({ label, value, row }): [NF.Row, NF.Value] => [NF.Constructors.Extension(label, value, row), value],
							)
							.with({ type: "extension" }, (r): [NF.Row, NF.Value] => {
								const [rr, vv] = from(l, r);
								return [NF.Constructors.Extension(r.label, r.value, rr), vv];
							})
							.with({ type: "variable" }, (r): [NF.Row, NF.Value] => {
								const val = NF.evaluate(ctx.env, ctx.imports, EB.Constructors.Var(freshMeta()));
								return [NF.Constructors.Extension(l, val, r), val];
							})
							.exhaustive();

					const [r, v] = from(label, arg.row);
					const inferred = NF.Constructors.App(func, NF.Constructors.Row(r), "Explicit");
					return M.fmap(M.tell({ type: "assign", left: inferred, right: ty }), () => v);
				},
			)
			.otherwise(_ => {
				throw new Error("Expected Row Type");
			}),
	);

const inject = (label: string, value: EB.AST, tm: EB.AST): M.Elaboration<NF.Value> =>
	M.chain(M.ask(), ctx =>
		match(tm[1])
			.with({ type: "Neutral" }, ({ value: v }) => inject(label, value, [tm[0], v, tm[2]]))
			.with({ type: "Var" }, _ => {
				const r: NF.Row = { type: "variable", variable: freshMeta() };
				const ctor = NF.evaluate(ctx.env, ctx.imports, EB.Constructors.Var(freshMeta()));

				const inferred = NF.Constructors.App(ctor, NF.Constructors.Row(r), "Explicit");
				const extended = NF.Constructors.App(ctor, NF.Constructors.Row(NF.Constructors.Extension(label, value[1], r)), "Explicit");
				return M.fmap(M.tell({ type: "assign", left: inferred, right: tm[1] }), () => extended);
			})
			.with(
				{ type: "App", func: { type: "Lit", value: { type: "Atom" } }, arg: { type: "Row" } },
				({
					func: {
						value: { value },
					},
				}) => value === "Schema" || value === "Variant",
				({ func, arg }) => {
					const extended = NF.Constructors.App(func, NF.Constructors.Row(NF.Constructors.Extension(label, value[1], arg.row)), "Explicit");
					return M.of(extended);
				},
			)
			.otherwise(_ => {
				throw new Error("Injection: Expected Row type");
			}),
	);
