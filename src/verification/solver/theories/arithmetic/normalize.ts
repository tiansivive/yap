// Arithmetic normalization: converts IVL Atom+Arith terms into canonical linear constraints.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md
// LIA = Linear Integer Arithmetic, LRA = Linear Real Arithmetic

import { match } from "ts-pattern";
import { pipe } from "fp-ts/function";
import * as O from "fp-ts/Option";
import type { IVL } from "../../ivl/types";
import type { AtomInfo } from "../../cnf";
import { Rational } from "./rational";

export type LinearExpr = {
	readonly coefficients: ReadonlyMap<string, Rational>;
	readonly constant: Rational;
};

export type LinearConstraint =
	| { readonly tag: "leq"; readonly expr: LinearExpr }
	| { readonly tag: "lt"; readonly expr: LinearExpr }
	| { readonly tag: "eq"; readonly expr: LinearExpr }
	| { readonly tag: "neq"; readonly expr: LinearExpr };

export type NormalizeResult = { readonly tag: "linear"; readonly constraint: LinearConstraint; readonly sort: IVL.NumSort } | { readonly tag: "nonlinear" };

const termKey = (term: IVL.Term): string =>
	match(term)
		.with({ tag: "Var" }, ({ name }) => name)
		.with({ tag: "Const" }, ({ name }) => name)
		.with({ tag: "App" }, ({ head, args }) => `${head}(${args.map(termKey).join(",")})`)
		.with({ tag: "Select" }, ({ array, index }) => `select(${termKey(array)},${termKey(index)})`)
		.otherwise(t => `?${t.tag}`);

const EMPTY_COEFFICIENTS: ReadonlyMap<string, Rational> = new Map();

const expr = (coefficients: ReadonlyMap<string, Rational>, constant: Rational): LinearExpr => ({
	coefficients,
	constant,
});

const variable = (name: string): LinearExpr => expr(new Map([[name, Rational.one]]), Rational.zero);

const constant = (value: Rational): LinearExpr => expr(EMPTY_COEFFICIENTS, value);

const addExpr = (a: LinearExpr, b: LinearExpr): LinearExpr => {
	const merged = new Map(a.coefficients);
	b.coefficients.forEach((coeff, name) => {
		const existing = merged.get(name) ?? Rational.zero;
		const sum = Rational.add(existing, coeff);
		Rational.isZero(sum) ? merged.delete(name) : merged.set(name, sum);
	});
	return expr(merged, Rational.add(a.constant, b.constant));
};

const subExpr = (a: LinearExpr, b: LinearExpr): LinearExpr => addExpr(a, scaleExpr(b, Rational.minusOne));

const scaleExpr = (e: LinearExpr, factor: Rational): LinearExpr =>
	Rational.isZero(factor)
		? expr(EMPTY_COEFFICIENTS, Rational.zero)
		: expr(new Map([...e.coefficients].map(([name, coeff]) => [name, Rational.mul(coeff, factor)])), Rational.mul(e.constant, factor));

const linearize = (term: IVL.Term): O.Option<LinearExpr> =>
	match(term)
		.with({ tag: "Num" }, ({ value }) => O.some(constant(Rational.fromNumber(Number(value)))))
		.with({ tag: "Var" }, ({ name }) => O.some(variable(name)))
		.with({ tag: "Const" }, ({ name }) => O.some(variable(name)))
		.with({ tag: "Arith" }, ({ op, args }) => linearizeArith(op, args[0], args[1]))
		.otherwise(() => O.some(variable(termKey(term))));

const linearizeArith = (op: IVL.ArithOp, left: IVL.Term, right: IVL.Term): O.Option<LinearExpr> =>
	pipe(
		sequenceTuple(linearize(left), linearize(right)),
		O.chain(([l, r]) => linearizeOp(op, l, r)),
	);

const sequenceTuple = <A, B>(a: O.Option<A>, b: O.Option<B>): O.Option<[A, B]> =>
	pipe(
		a,
		O.chain(av =>
			pipe(
				b,
				O.map(bv => [av, bv] as [A, B]),
			),
		),
	);

const linearizeOp = (op: IVL.ArithOp, left: LinearExpr, right: LinearExpr): O.Option<LinearExpr> =>
	match(op)
		.with("+", () => O.some(addExpr(left, right)))
		.with("-", () => O.some(subExpr(left, right)))
		.with("*", () => linearizeMul(left, right))
		.with("/", () => linearizeDiv(left, right))
		.exhaustive();

const isConstant = (e: LinearExpr): boolean => e.coefficients.size === 0;

const linearizeMul = (left: LinearExpr, right: LinearExpr): O.Option<LinearExpr> =>
	isConstant(left) ? O.some(scaleExpr(right, left.constant)) : isConstant(right) ? O.some(scaleExpr(left, right.constant)) : O.none;

const linearizeDiv = (left: LinearExpr, right: LinearExpr): O.Option<LinearExpr> =>
	isConstant(right) && !Rational.isZero(right.constant) ? O.some(scaleExpr(left, Rational.div(Rational.one, right.constant))) : O.none;

const numSort = (term: IVL.Term): O.Option<IVL.NumSort> =>
	match(term)
		.with({ tag: "Num" }, ({ sort }) => O.some(sort))
		.with({ tag: "Arith" }, ({ sort }) => O.some(sort))
		.with({ tag: "Var", sort: { tag: "Int" } }, ({ sort }) => O.some(sort as IVL.NumSort))
		.with({ tag: "Var", sort: { tag: "Real" } }, ({ sort }) => O.some(sort as IVL.NumSort))
		.with({ tag: "Const", sort: { tag: "Int" } }, ({ sort }) => O.some(sort as IVL.NumSort))
		.with({ tag: "Const", sort: { tag: "Real" } }, ({ sort }) => O.some(sort as IVL.NumSort))
		.otherwise(() => O.none);

const sequenceTriple = <A, B, C>(a: O.Option<A>, b: O.Option<B>, c: O.Option<C>): O.Option<[A, B, C]> =>
	pipe(
		a,
		O.chain(av =>
			pipe(
				b,
				O.chain(bv =>
					pipe(
						c,
						O.map(cv => [av, bv, cv] as [A, B, C]),
					),
				),
			),
		),
	);

export const Normalize = {
	atom: (info: AtomInfo): NormalizeResult =>
		pipe(
			sequenceTriple(linearize(info.args[0]), linearize(info.args[1]), numSort(info.args[0])),
			O.match(
				(): NormalizeResult => ({ tag: "nonlinear" }),
				([left, right, sort]): NormalizeResult => ({
					tag: "linear",
					constraint: atomToConstraint(info.op, left, right),
					sort,
				}),
			),
		),

	negate: (constraint: LinearConstraint, sort: IVL.NumSort): LinearConstraint =>
		match(constraint)
			.with({ tag: "leq" }, ({ expr: e }) =>
				match(sort)
					.with({ tag: "Int" }, () => ({ tag: "leq" as const, expr: subExpr(constant(Rational.minusOne), e) }))
					.with({ tag: "Real" }, () => ({ tag: "lt" as const, expr: flipExpr(e) }))
					.exhaustive(),
			)
			.with({ tag: "lt" }, ({ expr: e }) => ({ tag: "leq" as const, expr: flipExpr(e) }))
			.with({ tag: "eq" }, ({ expr: e }) => ({ tag: "neq" as const, expr: e }))
			.with({ tag: "neq" }, ({ expr: e }) => ({ tag: "eq" as const, expr: e }))
			.exhaustive(),
};

const flipExpr = (e: LinearExpr): LinearExpr => ({
	constant: Rational.neg(e.constant),
	coefficients: new Map([...e.coefficients].map(([k, v]) => [k, Rational.neg(v)])),
});

const atomToConstraint = (op: IVL.AtomOp, left: LinearExpr, right: LinearExpr): LinearConstraint => {
	const diff = subExpr(left, right);
	return match(op)
		.with("=", () => ({ tag: "eq" as const, expr: diff }))
		.with("!=", () => ({ tag: "neq" as const, expr: diff }))
		.with("<=", () => ({ tag: "leq" as const, expr: diff }))
		.with("<", () => ({ tag: "lt" as const, expr: diff }))
		.with(">=", () => ({ tag: "leq" as const, expr: subExpr(right, left) }))
		.with(">", () => ({ tag: "lt" as const, expr: subExpr(right, left) }))
		.exhaustive();
};
