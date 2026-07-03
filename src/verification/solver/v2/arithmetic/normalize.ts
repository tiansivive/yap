// Arithmetic normalization: converts IVL atoms into canonical linear constraints.
// LIA = Linear Integer Arithmetic; LRA = Linear Real Arithmetic.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/function";
import { match } from "ts-pattern";
import type { IVL } from "../../ivl/types";
import type * as Encoding from "../encoding";
import { Rational } from "./rational";

const Patterns = {
	Term: {
		Num: { tag: "Num" } as const,
		Var: { tag: "Var" } as const,
		Const: { tag: "Const" } as const,
		App: { tag: "App" } as const,
		Arith: { tag: "Arith" } as const,
		Select: { tag: "Select" } as const,
	},
	Sort: {
		Int: { tag: "Int" } as const,
		Real: { tag: "Real" } as const,
	},
} as const;

export const Normalize = {
	atom: (atom: Encoding.Atom.T): Normalize.Result =>
		pipe(
			Option.triple(Linear.from(atom.args[0]), Linear.from(atom.args[1]), Sort.num(atom.args[0])),
			O.map(
				([left, right, sort]): Normalize.Result => ({
					tag: "linear",
					constraint: Constraint.from(atom.op, left, right),
					sort,
				}),
			),
			O.getOrElse((): Normalize.Result => ({ tag: "nonlinear" })),
		),

	negate: (constraint: Constraint, sort: IVL.NumSort): Constraint =>
		match(constraint)
			.with({ tag: "leq" }, ({ expr }) =>
				match(sort)
					.with(Patterns.Sort.Int, () => ({ tag: "leq" as const, expr: Linear.sub(Linear.constant(Rational.minusOne), expr) }))
					.with(Patterns.Sort.Real, () => ({ tag: "lt" as const, expr: Linear.flip(expr) }))
					.exhaustive(),
			)
			.with({ tag: "lt" }, ({ expr }) => ({ tag: "leq" as const, expr: Linear.flip(expr) }))
			.with({ tag: "eq" }, ({ expr }) => ({ tag: "neq" as const, expr }))
			.with({ tag: "neq" }, ({ expr }) => ({ tag: "eq" as const, expr }))
			.exhaustive(),
};

export namespace Normalize {
	export type Result = { readonly tag: "linear"; readonly constraint: Constraint; readonly sort: IVL.NumSort } | { readonly tag: "nonlinear" };
}

export namespace Linear {
	export type Expr = {
		readonly coefficients: ReadonlyMap<string, Rational>;
		readonly constant: Rational;
	};

	export const empty: ReadonlyMap<string, Rational> = new Map();

	export const expr = (coefficients: ReadonlyMap<string, Rational>, constant: Rational): Expr => ({ coefficients, constant });

	export const variable = (name: string): Expr => expr(new Map([[name, Rational.one]]), Rational.zero);

	export const constant = (value: Rational): Expr => expr(empty, value);

	export const add = (a: Expr, b: Expr): Expr => expr(Coefficients.add(a.coefficients, b.coefficients), Rational.add(a.constant, b.constant));

	export const sub = (a: Expr, b: Expr): Expr => add(a, scale(b, Rational.minusOne));

	export const scale = (e: Expr, factor: Rational): Expr =>
		Rational.isZero(factor)
			? constant(Rational.zero)
			: expr(new Map([...e.coefficients].map(([name, coeff]) => [name, Rational.mul(coeff, factor)])), Rational.mul(e.constant, factor));

	export const flip = (e: Expr): Expr => ({
		constant: Rational.neg(e.constant),
		coefficients: new Map([...e.coefficients].map(([k, v]) => [k, Rational.neg(v)])),
	});

	export const from = (term: IVL.Term): O.Option<Expr> =>
		match(term)
			.with(Patterns.Term.Num, ({ value }) => O.some(constant(Rational.from(Number(value)))))
			.with(Patterns.Term.Var, ({ name }) => O.some(variable(name)))
			.with(Patterns.Term.Const, ({ name }) => O.some(variable(name)))
			.with(Patterns.Term.Arith, ({ op, args }) => Arith.from(op, args[0], args[1]))
			.otherwise(() => O.some(variable(Key.term(term))));

	export const isConstant = (e: Expr): boolean => e.coefficients.size === 0;
}

export type Constraint =
	| { readonly tag: "leq"; readonly expr: Linear.Expr }
	| { readonly tag: "lt"; readonly expr: Linear.Expr }
	| { readonly tag: "eq"; readonly expr: Linear.Expr }
	| { readonly tag: "neq"; readonly expr: Linear.Expr };

export namespace Constraint {
	export type Info = {
		readonly constraint: Constraint;
		readonly sort: IVL.NumSort;
	};

	export const from = (op: IVL.AtomOp, left: Linear.Expr, right: Linear.Expr): Constraint => {
		const diff = Linear.sub(left, right);
		return match(op)
			.with("=", () => ({ tag: "eq" as const, expr: diff }))
			.with("!=", () => ({ tag: "neq" as const, expr: diff }))
			.with("<=", () => ({ tag: "leq" as const, expr: diff }))
			.with("<", () => ({ tag: "lt" as const, expr: diff }))
			.with(">=", () => ({ tag: "leq" as const, expr: Linear.sub(right, left) }))
			.with(">", () => ({ tag: "lt" as const, expr: Linear.sub(right, left) }))
			.exhaustive();
	};
}

const Arith = {
	from: (op: IVL.ArithOp, left: IVL.Term, right: IVL.Term): O.Option<Linear.Expr> =>
		O.Monad.chain(Option.pair(Linear.from(left), Linear.from(right)), ([l, r]) => Arith.op(op, l, r)),

	op: (op: IVL.ArithOp, left: Linear.Expr, right: Linear.Expr): O.Option<Linear.Expr> =>
		match(op)
			.with("+", () => O.some(Linear.add(left, right)))
			.with("-", () => O.some(Linear.sub(left, right)))
			.with("*", () => Arith.mul(left, right))
			.with("/", () => Arith.div(left, right))
			.exhaustive(),

	mul: (left: Linear.Expr, right: Linear.Expr): O.Option<Linear.Expr> =>
		match([Linear.isConstant(left), Linear.isConstant(right)])
			.with([true, false], () => O.some(Linear.scale(right, left.constant)))
			.with([false, true], () => O.some(Linear.scale(left, right.constant)))
			.with([true, true], () => O.some(Linear.scale(right, left.constant)))
			.otherwise(() => O.none),

	div: (left: Linear.Expr, right: Linear.Expr): O.Option<Linear.Expr> =>
		match([Linear.isConstant(right), Rational.isZero(right.constant)])
			.with([true, false], () => O.some(Linear.scale(left, Rational.div(Rational.one, right.constant))))
			.otherwise(() => O.none),
};

const Coefficients = {
	add: (a: ReadonlyMap<string, Rational>, b: ReadonlyMap<string, Rational>): ReadonlyMap<string, Rational> =>
		[...b.entries()].reduce<ReadonlyMap<string, Rational>>(
			(acc, [name, coeff]) => Coefficients.set(acc, name, Rational.add(acc.get(name) ?? Rational.zero, coeff)),
			a,
		),

	set: (coefficients: ReadonlyMap<string, Rational>, name: string, value: Rational): ReadonlyMap<string, Rational> =>
		match(Rational.isZero(value))
			.with(true, () => new Map([...coefficients.entries()].filter(([key]) => key !== name)))
			.with(false, () => new Map([...coefficients, [name, value]]))
			.exhaustive(),
};

const Sort = {
	num: (term: IVL.Term): O.Option<IVL.NumSort> =>
		match(term)
			.with(Patterns.Term.Num, ({ sort }) => O.some(sort))
			.with(Patterns.Term.Arith, ({ sort }) => O.some(sort))
			.with({ tag: "Var", sort: Patterns.Sort.Int }, ({ sort }) => O.some(sort))
			.with({ tag: "Var", sort: Patterns.Sort.Real }, ({ sort }) => O.some(sort))
			.with({ tag: "Const", sort: Patterns.Sort.Int }, ({ sort }) => O.some(sort))
			.with({ tag: "Const", sort: Patterns.Sort.Real }, ({ sort }) => O.some(sort))
			.otherwise(() => O.none),
};

const Option = {
	pair: <A, B>(a: O.Option<A>, b: O.Option<B>): O.Option<readonly [A, B]> => O.Monad.chain(a, av => O.Functor.map(b, bv => [av, bv] as const)),

	triple: <A, B, C>(a: O.Option<A>, b: O.Option<B>, c: O.Option<C>): O.Option<readonly [A, B, C]> =>
		O.Monad.chain(Option.pair(a, b), ([av, bv]) => O.Functor.map(c, cv => [av, bv, cv] as const)),
};

const Key = {
	term: (term: IVL.Term): string =>
		match(term)
			.with(Patterns.Term.Var, ({ name }) => name)
			.with(Patterns.Term.Const, ({ name }) => name)
			.with(Patterns.Term.App, ({ head, args }) => `${head}(${args.map(Key.term).join(",")})`)
			.with(Patterns.Term.Select, ({ array, index }) => `select(${Key.term(array)},${Key.term(index)})`)
			.otherwise(t => `?${t.tag}`),
};
