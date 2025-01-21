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
import {
	displayConstraint,
	displayContext,
	displayValue,
	print,
} from "./pretty";
import { log } from "./logging";
import { SR, Usages } from "./multiplicity";
import * as Q from "./multiplicity";
import { zipWith } from "lodash";
import { replicate, unsafeUpdateAt, updateAt } from "fp-ts/lib/Array";

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
	| { type: "assign"; left: NF.Value; right: NF.Value }
	| { type: "usage"; computed: Multiplicity; expected: Multiplicity };
//| { type: "equals"; left: El.ModalTerm; right: El.ModalTerm }

type Elaboration<T> = RW.RW<Context, Constraint[], T>;

export type AST = [El.Term, NF.Value, Usages];

let count = 0;

export function infer(ast: Src.Term): Elaboration<AST> {
	const result = F.pipe(
		ask(),
		chain((ctx) => {
			log("entry", "Infer", {
				Context: displayContext(ctx),
				AST: srcPrint(ast),
			});
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
						{ type: "Lit", value: atom },
						Q.noUsage(ctx.env.length),
					]);
				})

				.with({ type: "hole" }, (_) => {
					const meta = El.Var(freshMeta());
					const ty = Eval.evaluate(env, ctx.imports, meta);
					// const modal = NF.infer(env, annotation);
					return of<AST>([meta, ty, Q.noUsage(ctx.env.length)]);
				})

				.with(
					{ type: "var" },
					({ variable }): Elaboration<AST> => of<AST>(lookup(variable, ctx)),
				)
				.with({ type: "annotation" }, ({ term, ann, multiplicity }) =>
					F.pipe(
						Do,
						bind_("ann", (_) => check(ann, NF.Type)),
						bind_("type", ({ ann: [type, us] }) => {
							const val = Eval.evaluate(env, ctx.imports, type);
							//const mval = NF.infer(env, val);
							return of([val, us] as const);
						}),
						bind_("term", ({ type: [type, us] }) => check(term, type)),
						RW.fmap(
							({ term: [term], type: [type, us] }): AST => [term, type, us],
						),
					),
				)

				.with({ type: "application" }, ({ fn, arg, icit }) =>
					F.pipe(
						Do,
						bind_("fn", () =>
							chain(infer(fn), icit === "Explicit" ? insertImplicitApps : of),
						),

						bind_("pi", ({ fn: [ft, fty] }) =>
							match(fty)
								.with({ type: "Abs", binder: { type: "Pi" } }, (pi) => {
									if (pi.binder.icit !== icit) {
										throw new Error("Implicitness mismatch");
									}

									return of([
										pi.binder.annotation,
										pi.closure,
										pi.binder.variable,
									] as const);
								})
								.otherwise(() => {
									const meta = Con.Term.Var(freshMeta());
									const nf = Eval.evaluate(env, ctx.imports, meta);
									const mnf: NF.ModalValue = [nf, Shared.Many];
									const closure = NF.Closure(env, Con.Term.Var(freshMeta()));

									const pi = Con.Type.Pi("x", icit, mnf, closure);

									return F.pipe(
										of([mnf, closure, "x"] as const),
										discard(() =>
											tell({ type: "assign", left: fty, right: pi }),
										),
									);
								}),
						),
						bind_("arg", ({ pi: [ann] }) => local(ctx, check(arg, ann[0]))),
						chain(({ fn: [ft, fty, fus], arg: [at, aus], pi }) => {
							const [[, q], cls] = pi;
							const rus = Q.add(fus, Q.multiply(q, aus));

							const val = Eval.apply(
								ctx.imports,
								cls,
								Eval.evaluate(env, ctx.imports, at),
								q,
							);

							const ast: AST = [Con.Term.App(icit, ft, at), val, rus];
							return of(ast);
						}),
					),
				)

				.with({ type: "pi" }, { type: "arrow" }, (pi): Elaboration<AST> => {
					const v = pi.type === "pi" ? pi.variable : `t${++count}`;
					const body = pi.type === "pi" ? pi.body : pi.rhs;
					const ann = pi.type === "pi" ? pi.annotation : pi.lhs;
					const q =
						pi.type === "pi" && pi.multiplicity ? pi.multiplicity : Shared.Many;

					return F.pipe(
						Do,
						bind_("ann", () => check(ann, NF.Type)),
						bind_("body", ({ ann: [ann] }) => {
							const va = Eval.evaluate(env, ctx.imports, ann);
							const mva: NF.ModalValue = [va, q];
							const ctx_ = bind(ctx, v, mva);
							return local(ctx_, check(body, NF.Type));
						}),
						RW.fmap(({ ann: [ann, aus], body: [body, [, ...busTail]] }) => [
							Con.Term.Pi(v, pi.icit, q, ann, body),
							NF.Type,
							Q.add(aus, busTail),
						]),
					);
				})
				.with({ type: "lambda" }, (lam): Elaboration<AST> => {
					const meta: El.Term = El.Var(freshMeta());
					const ann = lam.annotation
						? check(lam.annotation, NF.Type)
						: of<[El.Term, Usages]>([meta, Q.noUsage(ctx.env.length)]);
					return chain(ann, ([tm]) => {
						const va = Eval.evaluate(env, ctx.imports, tm);
						const mva: NF.ModalValue = [
							va,
							lam.multiplicity ? lam.multiplicity : Shared.Many,
						];
						const ctx_ = bind(ctx, lam.variable, mva);
						return local(
							ctx_,
							F.pipe(
								infer(lam.body),
								chain(insertImplicitApps),
								discard(([, , [vu]]) =>
									tell({ type: "usage", expected: mva[1], computed: vu }),
								),
								RW.fmap(([bTerm, bType, [vu, ...us]]): AST => {
									const tm = Con.Term.Lambda(lam.variable, lam.icit, bTerm);
									const pi = Con.Type.Pi(
										lam.variable,
										lam.icit,
										mva,
										closeVal(ctx, bType),
									);

									return [tm, pi, us]; // Remove the usage of the bound variable
								}),
							),
						);
					});
				})
				.otherwise(() => {
					throw new Error("Not implemented yet");
				});
		}),
		discard(([tm, ty, us]) => {
			log("exit", "Result", {
				Term: print(tm),
				Type: displayValue(ty),
				Usages: us,
			});
			return of(null);
		}),
	);
	return result;
}

function check(term: Src.Term, type: NF.Value): Elaboration<[El.Term, Usages]> {
	return F.pipe(
		ask(),
		chain((ctx) => {
			log("entry", "Check", {
				Term: srcPrint(term),
				Annotation: displayValue(type),
			});
			return match([term, type])
				.with(
					[{ type: "lambda" }, { type: "Abs", binder: { type: "Pi" } }],
					([tm, ty]) => tm.icit === ty.binder.icit,
					([tm, ty]) => {
						const bType = Eval.apply(
							ctx.imports,
							ty.closure,
							Con.Type.Rigid(ctx.env.length),
						);

						const ctx_ = bind(ctx, tm.variable, ty.binder.annotation);
						return local(
							ctx_,
							F.pipe(
								check(tm.body, bType),
								discard(([, [vu]]) =>
									tell({
										type: "usage",
										expected: ty.binder.annotation[1],
										computed: vu,
									}),
								),
								RW.fmap(([body, [, ...us]]): [El.Term, Usages] => [
									Con.Term.Lambda(tm.variable, tm.icit, body),
									us,
								]),
							),
						);
					},
				)
				.with(
					[P._, { type: "Abs", binder: { type: "Pi" } }],
					([_, ty]) => ty.binder.icit === "Implicit",
					([tm, ty]) => {
						const bType = Eval.apply(
							ctx.imports,
							ty.closure,
							Con.Type.Rigid(ctx.env.length),
						);
						const ctx_ = bindInsertedImplicit(
							ctx,
							ty.binder.variable,
							ty.binder.annotation,
						);
						return local(
							ctx_,
							F.pipe(
								check(tm, bType),
								discard(([, [vu]]) =>
									tell({
										type: "usage",
										expected: ty.binder.annotation[1],
										computed: vu,
									}),
								),
								RW.fmap(([tm, [, ...us]]): [El.Term, Usages] => [
									Con.Term.Lambda(ty.binder.variable, "Implicit", tm),
									us,
								]),
							),
						);
					},
				)
				.with([{ type: "hole" }, P._], () =>
					of<[El.Term, Usages]>([Con.Term.Var(freshMeta()), []]),
				)
				.otherwise(([tm, _]) =>
					F.pipe(
						infer(tm),
						chain(insertImplicitApps),
						discard(([, inferred]) => {
							return tell({
								type: "assign",
								left: inferred,
								right: type,
							});
						}),
						RW.fmap(([tm, , us]): [El.Term, Usages] => [tm, us]),
					),
				);
		}),
		listen(([[tm, us], csts]) => {
			log("exit", "Result", {
				Term: print(tm),
				Usages: us,
				Constraints: csts.map(displayConstraint),
			});
			return [tm, us];
		}),
	);
}

function insertImplicitApps(node: AST): Elaboration<AST> {
	const [term, ty, us] = node;
	return F.pipe(
		ask(),
		chain((ctx) => {
			log("entry", "Insert", { Term: print(term), Type: displayValue(ty) });
			return match(node)
				.with(
					[
						{ type: "Abs", binding: { type: "Lambda", icit: "Implicit" } },
						P._,
						P._,
					],
					() => of<AST>(node),
				)
				.with(
					[P._, { type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, P._],
					([, pi]) => {
						const meta = Con.Term.Var(freshMeta());
						const vNF = Eval.evaluate(ctx.env, ctx.imports, meta);

						const tm = Con.Term.App("Implicit", term, meta);

						const bodyNF = Eval.apply(ctx.imports, pi.closure, vNF);

						return insertImplicitApps([tm, bodyNF, us]);
					},
				)
				.otherwise(() => of(node));
		}),
		discard(([tm, ty]) => {
			log("exit", "Result", { Term: print(tm), Type: displayValue(ty) });
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
		const zeros = replicate<Multiplicity>(ctx.env.length, Shared.Zero);
		if (types.length === 0) {
			const free = ctx.imports[variable.value];
			if (free) {
				const [, nf, us] = free;
				return [
					El.Var({ type: "Free", name: variable.value }),
					nf,
					Q.add(us, zeros),
				];
			}

			throw new Error("Variable not found");
		}

		const [[name, origin, [nf, m]], ...rest] = types;
		const usages = unsafeUpdateAt(i, m, zeros);
		if (name === variable.value && origin === "source") {
			return [El.Var({ type: "Bound", index: i }), nf, usages];
		}

		return _lookup(i + 1, variable, rest);
	};

	return _lookup(0, variable, ctx.types);
};

const closeVal = (ctx: Context, value: NF.Value): NF.Closure => ({
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

const multiply = (m: Multiplicity, ctx: Context): Context => {
	const env = ctx.env.map(([v, q]): Context["env"][0] => [v, SR.mul(q, m)]);
	const types = ctx.types.map(([v, o, [ty, q]]): Context["types"][0] => [
		v,
		o,
		[ty, SR.mul(q, m)],
	]);
	return { ...ctx, env, types };
};

const add = (ctx1: Context, ctx2: Context): Context => {
	const env = ctx1.env.map(([v1, q1], i): Context["env"][0] => {
		const [v2, q2] = ctx2.env[i];
		// if (v1 !== v2) {
		// 	throw new Error("Environments do not match");
		// }
		return [v1, SR.add(q1, q2)];
	});

	const types = ctx1.types.map(
		([v1, o1, [ty1, q1]], i): Context["types"][0] => {
			const [v2, o2, [ty2, q2]] = ctx2.types[i];
			// if (v1 !== v2 || o1 !== o2 || ty1 !== ty2) {
			// 	throw new Error("Types do not match");
			// }
			return [v1, o1, [ty1, SR.add(q1, q2)]];
		},
	);

	return { ...ctx1, env, types };
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
