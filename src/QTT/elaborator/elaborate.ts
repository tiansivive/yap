import { match } from "ts-pattern";
import * as Src from "../parser/src";

import * as El from "./syntax";
import * as NF from "./normalized";
import * as Eval from "./evaluator";

import * as Con from "./constructors";

import Shared, { Literal, Multiplicity } from "../shared";
import { Reader } from "fp-ts/lib/Reader";
import { Writer } from "fp-ts/lib/Writer";

import * as RW from "./monad";

import * as F from "fp-ts/lib/function";
import * as R from "fp-ts/lib/Reader";
import * as W from "fp-ts/lib/Writer";

import { Monoid } from "fp-ts/lib/Monoid";
import { freshMeta } from "./supply";

import { P } from "ts-pattern";
import { print as srcPrint } from "../parser/pretty";
import { print } from "./pretty";
import { log } from "./logging";

type Origin = "inserted" | "source";
// type Node = { type: "node", value: El.Term, annotation: NF.Value }
// type Node = [El.Term, NF.ModalValue]

export type Context = {
	types: Array<[String, Origin, NF.ModalValue]>;
	env: NF.Env;
	names: Array<String>;
	imports: Record<string, AST>;
};

export type Constraint =
	//| { type: "equals"; left: El.ModalTerm; right: El.ModalTerm }
	{ type: "assign"; left: NF.ModalValue; right: NF.ModalValue };

type Elaboration<T> = RW.RW<Context, Constraint[], T>;

export type AST = [El.Term, NF.ModalValue];

let count = 0;

export function infer(ast: Src.Term): Elaboration<AST> {
	const result = F.pipe(
		ask(),
		chain((ctx) => {
			log("entry", "Infer", { Context: ctx, AST: srcPrint(ast) });
			const { env } = ctx;
			return match(ast)
				.with({ type: "lit" }, ({ value }): Elaboration<AST> => {
					const atom: Literal = match(value)
						.with({ type: "String" }, (_) => Shared.Atom("String"))
						.with({ type: "Num" }, (_) => Shared.Atom("Num"))
						.with({ type: "Bool" }, (_) => Shared.Atom("Bool"))
						.with({ type: "Atom" }, (_) => Shared.Atom("Type"))
						.exhaustive();

					return of<AST>([
						{ type: "Lit", value },
						[{ type: "Lit", value: atom }, Shared.Many],
					]);
				})

				.with({ type: "hole" }, (_) => {
					const meta = El.Var(freshMeta());
					const annotation = Eval.evaluate(env, ctx.imports, meta);
					const modal = NF.infer(env, annotation);
					return of<AST>([meta, modal]);
				})

				.with(
					{ type: "var" },
					({ variable }): Elaboration<AST> => of<AST>(lookup(variable, ctx)),
				)
				.with({ type: "annotation" }, ({ term, ann }) =>
					F.pipe(
						Do,
						bind_("type", (_) => check(ann, NF.Type)),
						bind_("mtype", ({ type }) => {
							const val = Eval.evaluate(env, ctx.imports, type);
							const mval = NF.infer(env, val);
							return of(mval);
						}),
						bind_("term", ({ mtype }) => check(term, mtype)),
						RW.fmap(({ term, mtype }): AST => [term, mtype]),
					),
				)

				.with({ type: "application" }, ({ fn, arg, icit }) =>
					F.pipe(
						infer(fn),
						chain(icit === "Explicit" ? insertImplicitApps : of),
						chain(([t, [ty, m]]) => {
							const components = match(ty)
								.with({ type: "Abs", binder: { type: "Pi" } }, (pi) => {
									if (pi.binder.icit !== icit) {
										throw new Error("Implicitness mismatch");
									}

									return of([pi.binder.annotation, pi.closure] as const);
								})
								.otherwise(() => {
									const meta = Con.Term.Var(freshMeta());
									const nf = Eval.evaluate(env, ctx.imports, meta);
									const mnf = NF.infer(env, nf);
									const closure = NF.Closure(env, Con.Term.Var(freshMeta()));

									const pi = Con.Type.Pi("x", icit, mnf, closure);
									const mpi = NF.infer(env, pi);

									return F.pipe(
										of([mnf, closure] as const),
										discard(() =>
											tell({ type: "assign", left: [ty, m], right: mpi }),
										),
									);
								});

							return F.pipe(
								Do,
								bind_("components", () => components),
								bind_("arg", ({ components: [ann] }) => check(arg, ann)),
								RW.fmap(({ arg, components }): AST => {
									const [, cls] = components;
									const val = Eval.apply(
										ctx.imports,
										cls,
										Eval.evaluate(env, ctx.imports, arg),
									);
									const mval = NF.infer(env, val);
									return [Con.Term.App(icit, t, arg), mval];
								}),
							);
						}),
					),
				)
				.with({ type: "pi" }, { type: "arrow" }, (pi): Elaboration<AST> => {
					const v = pi.type === "pi" ? pi.variable : `t${++count}`;
					const body = pi.type === "pi" ? pi.body : pi.rhs;
					const ann = pi.type === "pi" ? pi.annotation : pi.lhs;

					return F.pipe(
						Do,
						bind_("ann", () => check(ann, NF.Type)),
						bind_("body", ({ ann }) => {
							const va = Eval.evaluate(env, ctx.imports, ann);
							const mva = NF.infer(env, va);
							const ctx_ = bind(ctx, v, mva);
							return local(ctx_, check(body, NF.Type));
						}),
						RW.fmap(({ ann, body }) => [
							Con.Term.Pi(v, pi.icit, ann, body),
							NF.Type,
						]),
					);
				})
				.with({ type: "lambda" }, (lam): Elaboration<AST> => {
					const meta: El.Term = El.Var(freshMeta());
					const ann = lam.annotation
						? check(lam.annotation, NF.Type)
						: of(meta);
					return chain(ann, (tm) => {
						const va = Eval.evaluate(env, ctx.imports, tm);
						const mva = NF.infer(env, va);
						const ctx_ = bind(ctx, lam.variable, mva);
						return local(
							ctx_,
							F.pipe(
								infer(lam.body),
								chain(insertImplicitApps),
								RW.fmap(
									([body, bodyTy]): AST => [
										Con.Term.Lambda(lam.variable, lam.icit, body),
										[
											Con.Type.Pi(
												lam.variable,
												lam.icit,
												mva,
												closeVal(ctx, bodyTy),
											),
											Shared.Many,
										],
									],
								),
							),
						);
					});
				})
				.otherwise(() => {
					throw new Error("Not implemented yet");
				});
		}),
		discard(([tm, ty]) => {
			log("exit", "Result", { Term: print(tm), Type: print(ty) });
			return of(null);
		}),
	);
	return result;
}

function check(
	term: Src.Term,
	annotation: NF.ModalValue,
): Elaboration<El.Term> {
	return F.pipe(
		ask(),
		chain((ctx) => {
			log("entry", "Check", {
				Term: srcPrint(term),
				Annotation: print(annotation),
			});
			const [ty] = annotation;
			return match([term, ty])
				.with(
					[{ type: "lambda" }, { type: "Abs", binder: { type: "Pi" } }],
					([tm, ty]) => tm.icit === ty.binder.icit,
					([tm, ty]) => {
						// const [m, n] = checkModality(tm.multiplicity, q)
						const bodyTy = Eval.apply(
							ctx.imports,
							ty.closure,
							Con.Type.Rigid(ctx.env.length),
						);
						const mbody = NF.infer(ctx.env, bodyTy);

						const ctx_ = bind(ctx, tm.variable, ty.binder.annotation);
						return local(
							ctx_,
							F.pipe(
								check(tm.body, mbody),
								RW.fmap(
									(body): El.Term =>
										Con.Term.Lambda(tm.variable, tm.icit, body),
								),
							),
						);
					},
				)
				.with(
					[P._, { type: "Abs", binder: { type: "Pi" } }],
					([_, ty]) => ty.binder.icit === "Implicit",
					([tm, ty]) => {
						const bodyTy = Eval.apply(
							ctx.imports,
							ty.closure,
							Con.Type.Rigid(ctx.env.length),
						);
						const mbody = NF.infer(ctx.env, bodyTy);
						const ctx_ = bindInsertedImplicit(
							ctx,
							ty.binder.variable,
							ty.binder.annotation,
						);
						return local(
							ctx_,
							F.pipe(
								check(tm, mbody),
								RW.fmap(
									(tm): El.Term =>
										Con.Term.Lambda(ty.binder.variable, "Implicit", tm),
								),
							),
						);
					},
				)
				.with([{ type: "hole" }, P._], () =>
					of<El.Term>(Con.Term.Var(freshMeta())),
				)
				.otherwise(([tm, _]) =>
					F.pipe(
						infer(tm),
						chain(insertImplicitApps),
						discard(([, inferred]) => {
							return tell({
								type: "assign",
								left: inferred,
								right: annotation,
							});
						}),
						RW.fmap(([tm]) => tm),
					),
				);
		}),
		listen(([tm, csts]) => {
			log("exit", "Result", {
				Term: print(tm),
				Constraints: csts.map((c) => `${print(c.left)}  ~~  ${print(c.right)}`),
			});
			return tm;
		}),
	);
}

function insertImplicitApps(node: AST): Elaboration<AST> {
	const [term, ty] = node;
	return F.pipe(
		ask(),
		chain((ctx) => {
			log("entry", "Insert", { Term: print(term), Type: print(ty) });
			return match(node)
				.with(
					[{ type: "Abs", binding: { type: "Lambda", icit: "Implicit" } }, P._],
					() => of<AST>(node),
				)

				.with(
					[
						P._,
						[{ type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, P._],
					],
					([, [pi]]) => {
						const meta = Con.Term.Var(freshMeta());
						const vNF = Eval.evaluate(ctx.env, ctx.imports, meta);
						const vMNF = NF.infer(ctx.env, vNF);

						const tm = Con.Term.App("Implicit", term, meta);

						const bodyNF = Eval.apply(ctx.imports, pi.closure, vNF);
						const bodyMNF = NF.infer(ctx.env, bodyNF);

						return insertImplicitApps([tm, bodyMNF]);
					},
				)
				.otherwise(() => of(node));
		}),
		discard(([tm, ty]) => {
			log("exit", "Result", { Term: print(tm), Type: print(ty) });
			return of(null);
		}),
	);
}

const lookup = (variable: Src.Variable, ctx: Context): AST => {
	const _lookup = (
		i: number,
		variable: Src.Variable,
		types: Context["types"],
	): AST => {
		if (types.length === 0) {
			const free = ctx.imports[variable.value];
			if (free) {
				const [, mnf] = free;
				return [El.Var({ type: "Free", name: variable.value }), mnf];
			}

			throw new Error("Variable not found");
		}

		const [[name, origin, mnf], ...rest] = types;
		if (name === variable.value && origin === "source") {
			return [El.Var({ type: "Bound", index: i }), mnf];
		}

		return _lookup(i + 1, variable, rest);
	};

	return _lookup(0, variable, ctx.types);
};

const closeVal = (ctx: Context, [value]: NF.ModalValue): NF.Closure => ({
	env: ctx.env,
	term: NF.quote(ctx.imports, ctx.env.length + 1, value),
});

const bind = (
	context: Context,
	variable: string,
	annotation: NF.ModalValue,
): Context => {
	const [, q] = annotation;
	const { env, types } = context;
	return {
		...context,
		env: [[Con.Type.Rigid(env.length), q], ...env],
		types: [[variable, "source", annotation], ...types],
		names: [variable, ...context.names],
	};
};

const bindInsertedImplicit = (
	context: Context,
	variable: string,
	annotation: NF.ModalValue,
): Context => {
	const [, q] = annotation;
	const { env, types } = context;
	return {
		...context,
		env: [[Con.Type.Rigid(env.length), q], ...env],
		types: [[variable, "inserted", annotation], ...types],
		names: [variable, ...context.names],
	};
};

const monoid: Monoid<Constraint[]> = {
	concat: (x, y) => x.concat(y),
	empty: [],
};

export const of = RW.of(monoid) as <A>(a: A) => Elaboration<A>;
const ask = () =>
	RW.liftR<Context, Constraint[], Context>(monoid)(R.ask<Context>());
const chain = RW.getChain<Constraint[]>(monoid);

const Do: Elaboration<{}> = RW.Do(monoid);
const bind_ = RW.bind<Context, Constraint[]>(monoid);

const discard = <A, B>(f: (a: A) => RW.RW<Context, Constraint[], B>) =>
	chain<Context, A, A>((val) => RW.fmap(f(val), () => val));

const tell = <R>(constraint: Constraint) =>
	RW.liftW<R, Constraint[], void>(W.tell([constraint]));

export const listen =
	<A, B>(f: (aw: [A, Constraint[]]) => B) =>
	(rw: RW.RW<Context, Constraint[], A>): RW.RW<Context, Constraint[], B> =>
		F.pipe(rw, R.map(W.listen), RW.fmap(f));

const local: <A>(
	f: Context | ((ctx: Context) => Context),
	rw: RW.RW<Context, Constraint[], A>,
) => RW.RW<Context, Constraint[], A> = (f, rw) => {
	return (ctx: Context) => {
		const _ctx = typeof f === "function" ? f(ctx) : f;
		return rw(_ctx);
	};
};
