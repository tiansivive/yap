import { PostProcessor } from "nearley";
import { Implicitness, Literal } from "../shared";
import type { Statement, Term, Variable } from "./src";
import * as Src from "./src";

import { Token } from "moo";

export const Lit: PostProcessor<[Literal], Term> = ([l]) => Src.Lit(l);
export const Var: PostProcessor<[Variable], Term> = ([v]) => Src.Var(v);

export const Name: PostProcessor<[Token], Variable> = ([v]) => ({
	type: "name",
	value: v.value,
});

export const Hole: PostProcessor<[], Term> = () => Src.Hole;

export const Application: PostProcessor<[Term, Whitespace, Term], Term> = ([
	fn,
	,
	arg,
]) => Src.Application(fn, arg);
export const Operation: PostProcessor<
	[Term, Whitespace, Token, Whitespace, Term],
	Term
> = ([lhs, , op, , rhs]) =>
	Src.Application(
		Src.Application(Src.Var({ type: "name", value: op.value }), lhs),
		rhs,
	);

export const Annotation: PostProcessor<
	[Term, Whitespace, Colon, Whitespace, Term],
	Term
> = ([term, , colon, , ann]) => Src.Annotation(term, ann);

export const Pi: (
	icit: Implicitness,
) => PostProcessor<[Term, Whitespace, Token, Whitespace, Term], Term> =
	(icit) =>
	([expr, , arr, , body]) => {
		if (expr.type === "annotation") {
			const { term, ann } = expr;

			if (term.type !== "var") {
				throw new Error("Expected variable in Pi binding");
			}

			if (ann.type === "annotation") {
				throw new Error("No cumulative annotations in Pi bindings allowed");
			}

			return Src.Pi(icit, term.variable.value, ann, body);
		}

		return Src.Arrow(expr, body, icit);
	};

type Implicit = [Backslash, Hash, Param, Whitespace, Arrow, Whitespace, Term];
type Explicit = [Backslash, Param, Whitespace, Arrow, Whitespace, Term];
export const Lambda:
	| PostProcessor<Explicit, Term>
	| PostProcessor<Implicit, Term> = (data: Implicit | Explicit) => {
	if (data.length === 7) {
		const [, , param, , , , body] = data;
		return Src.Lambda("Implicit", param.binding.value, body, param.annotation);
	}
	const [, param, , , , body] = data;
	return Src.Lambda("Explicit", param.binding.value, body, param.annotation);
};

export const Param: PostProcessor<[Variable, ...Annotation], Param> = ([
	binding,
	...ann
]: [Variable, ...Annotation]): Param => ({
	type: "param",
	binding,
	annotation: ann.length === 0 ? undefined : ann[3],
});

type Param = { type: "param"; binding: Variable; annotation?: Term };

export const Block: PostProcessor<[[Statement[], Term]], Term> = ([
	[statements, ret],
]) => Src.Block(statements, ret);

export const Expr: PostProcessor<[Term], Statement> = ([value]) =>
	Src.Expression(value);

export const Return: PostProcessor<[Keyword, Whitespace, Term], Term> = ([
	,
	,
	term,
]) => term;

type LetDec = [
	Keyword,
	Whitespace,
	Variable,
	...Annotation,
	Whitespace,
	Equals,
	Whitespace,
	Term,
];
export const LetDec: PostProcessor<LetDec, Statement> = ([
	,
	,
	variable,
	...rest
]: LetDec) => {
	if (rest.length === 4) {
		const [, , , value] = rest;
		return Src.Let(variable.value, value);
	}

	const [, , , ann, , , , value] = rest;
	return Src.Let(variable.value, value, ann);
};

/**
 * Utils
 */

type Annotation = [Whitespace, Colon, Whitespace, Term] | [];

type LParens = Token;
type RParens = Token;
type Whitespace = Token;
type Newline = Token;
type Comma = Token;
type SemiColon = Token;
type Colon = Token;
type Backslash = Token;
type Hash = Token;
type Dot = Token;
type Arrow = Token;
type FatArrow = Token;
type Equals = Token;

type LBrace = Token;
type RBrace = Token;

type Keyword = Token;

type Unwrap<T> = PostProcessor<
	[LParens, Whitespace, T[], Whitespace, RParens],
	T
>;
export const unwrapParenthesis = <T>([l, , [t], , r]: [
	LParens,
	Whitespace,
	T[],
	Whitespace,
	RParens,
]) => t;
export const unwrapCurlyBraces = <T>([l, t, , , r]: [
	LBrace,
	T[],
	Whitespace,
	Newline,
	RBrace,
]) => t;
export const unwrapStatement = <T>([, , [t]]: [
	Newline,
	Whitespace,
	T[],
	Newline,
	Whitespace,
	SemiColon,
]) => t;
