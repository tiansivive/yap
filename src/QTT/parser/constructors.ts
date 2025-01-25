import { PostProcessor } from "nearley";
import { Implicitness, Literal, Multiplicity } from "../shared";
import type { Statement, Term, Variable, Row } from "./src";
import * as Src from "./src";

import { Token } from "moo";

export const Lit: PostProcessor<[Literal], Term> = ([l]) => Src.Lit(l);
export const Var: PostProcessor<[Variable], Term> = ([v]) => Src.Var(v);

export const Name: PostProcessor<[Token], Variable> = ([v]) => ({
	type: "name",
	value: v.value,
});

export const Hole: PostProcessor<[], Term> = () => Src.Hole;

export const Application: PostProcessor<[Term, Whitespace, Term], Term> = ([fn, , arg]) => Src.Application(fn, arg);
export const Operation: PostProcessor<[Term, Whitespace, Token, Whitespace, Term], Term> = ([lhs, , op, , rhs]) =>
	Src.Application(Src.Application(Src.Var({ type: "name", value: op.value }), lhs), rhs);

export const Annotation: PostProcessor<[Term, ...Annotation], Term> = ([term, ...rest]: [Term, ...Annotation]) => {
	if (rest.length === 0) {
		throw new Error("Expected annotation");
	}

	if (rest.length === 4) {
		const [, , , ann] = rest;
		return Src.Annotation(term, ann);
	}

	const q = rest[3];
	const ann = rest[5];
	return Src.Annotation(term, ann, q);
};

export const Pi: (icit: Implicitness) => PostProcessor<[Term, Whitespace, Token, Whitespace, Term], Term> =
	icit =>
	([expr, , arr, , body]) => {
		if (expr.type === "annotation") {
			const { term, ann, multiplicity } = expr;

			if (term.type !== "var") {
				throw new Error("Expected variable in Pi binding");
			}

			if (ann.type === "annotation") {
				throw new Error("No cumulative annotations in Pi bindings allowed");
			}

			return Src.Pi(icit, term.variable.value, ann, body, multiplicity);
		}

		return Src.Arrow(expr, body, icit);
	};

type Implicit = [Backslash, Hash, Param, Whitespace, Arrow, Whitespace, Term];
type Explicit = [Backslash, Param, Whitespace, Arrow, Whitespace, Term];
export const Lambda: PostProcessor<Explicit, Term> | PostProcessor<Implicit, Term> = (data: Implicit | Explicit) => {
	if (data.length === 7) {
		const [, , param, , , , body] = data;
		return Src.Lambda("Implicit", param.binding.value, body, param.annotation, param.multiplicity);
	}
	const [, param, , , , body] = data;
	return Src.Lambda("Explicit", param.binding.value, body, param.annotation, param.multiplicity);
};

export const Param: PostProcessor<[Variable, ...Annotation], Param> = ([binding, ...ann]: [Variable, ...Annotation]): Param => {
	if (ann.length === 0) {
		return {
			type: "param",
			binding,
		};
	}

	if (ann.length === 4) {
		const [, , , term] = ann;
		return {
			type: "param",
			binding,
			annotation: term,
		};
	}
	const q = ann[3];
	const term = ann[5];
	return {
		type: "param",
		binding,
		annotation: term,
		multiplicity: q,
	};
};

type Param = {
	type: "param";
	binding: Variable;
	annotation?: Term;
	multiplicity?: Multiplicity;
};

type KeyVal = [string, Term];
export const keyval: PostProcessor<[Variable, Whitespace, Colon, Whitespace, Term], KeyVal> = ([v, , , , tm]) => [v.value, tm];

export const emptyStruct = (): Term => Src.Struct({ type: "empty" });

export const struct: PostProcessor<[[KeyVal[]]], Term> = ([[pairs]]) => {
	const row = pairs.reduceRight<Row>((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), { type: "empty" });
	return Src.Struct(row);
};

export const Variant: PostProcessor<[Bar, KeyVal[]], Term> = ([, pairs]) => {
	const row = pairs.reduceRight<Row>((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), { type: "empty" });
	return Src.Variant(row);
};

export const tuple: PostProcessor<[[Term[]]], Term> = ([[terms]]) => {
	return Src.Tuple(terms);
};

export const list: PostProcessor<[[Term[]]], Term> = ([[terms]]) => {
	return Src.List(terms);
};

export const row: PostProcessor<[[KeyVal[], KeyVal]], Term> = ([[pairs, last]]): Term => {
	// TODO: Update when parsing accounts for row variables
	const end: Row = { type: "extension", label: last[0], value: last[1], row: { type: "empty" } };
	const row = pairs.reduceRight<Row>((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), end);
	return Src.Row(row);
};

export const Projection: PostProcessor<[Term, Dot, Variable] | [Dot, Variable], Term> = (input: [Term, Dot, Variable] | [Dot, Variable]) => {
	if (input.length === 2) {
		const [, variable] = input;
		const paramName = "x";
		return Src.Lambda("Explicit", paramName, Src.Projection(variable.value, Src.Var({ type: "name", value: paramName })));
	}
	const [term, , variable] = input;
	return Src.Projection(variable.value, term);
};

type Injection = [Whitespace, Term, Whitespace, Bar, KeyVal[]] | [Whitespace, Bar, KeyVal[]];
export const Injection: PostProcessor<[Injection], Term> = ([inj]) => {
	if (inj.length === 3) {
		const [, , pairs] = inj;
		const param = "x";
		const body = pairs.reduce((tm, [label, value]) => Src.Injection(label, value, tm), Src.Var({ type: "name", value: param }));
		return Src.Lambda("Explicit", param, body);
	}

	const [, term, , , pairs] = inj;
	return pairs.reduce((tm, [label, value]) => Src.Injection(label, value, tm), term);
};

export const Block: PostProcessor<[[Statement[], SemiColon, Term?] | [Term]], Term> = ([input]) => {
	if (Array.isArray(input[0])) {
		const [statements, , ret] = input;
		return Src.Block(statements, ret || undefined); // Ensure ret is undefined and not null
	}

	const [ret] = input;
	return Src.Block([], ret);
};

export const Expr: PostProcessor<[Term], Statement> = ([value]) => Src.Expression(value);

export const Return: PostProcessor<[Newline, Whitespace, Keyword, Whitespace, Term, SemiColon], Term> = d => d[4];

type LetDec = [Keyword, Whitespace, Variable, ...Annotation, Whitespace, Equals, Whitespace, Term];
export const LetDec: PostProcessor<[LetDec], Statement> = ([[, , variable, ...rest]]: [LetDec]) => {
	if (rest.length === 4) {
		const [, , , value] = rest;
		return Src.Let(variable.value, value);
	}

	if (rest.length === 8) {
		const [, , , ann, , , , value] = rest;
		return Src.Let(variable.value, value, ann);
	}

	const q = rest[3];
	const ann = rest[5];
	const value = rest[9];
	return Src.Let(variable.value, value, ann, q);
};

/**
 * Utils
 */

type Annotation = [Whitespace, Colon, Whitespace, Term] | [Whitespace, Colon, Whitespace, Multiplicity, Whitespace, Term] | [];

type LParens = Token;
type RParens = Token;
type LAngle = Token;
type RAngle = Token;
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
type Bar = Token;

type LBrace = Token;
type RBrace = Token;

type Keyword = Token;

export const none = () => undefined;
export const unwrap: <T>(arg: [Token, T[], Whitespace, Token]) => T = arg => {
	const [, [t]] = arg;
	return t;
};

export const extract: <T>(arg: [[T]]) => T = arg => {
	return arg[0][0];
};

export const many: <T>(arg: [Array<[Newline, Whitespace, T[], Newline, Whitespace, Token]>, Newline, Whitespace, T]) => T[] = arg => {
	const [arr, , , t2] = arg;

	const t1 = arr.flatMap(([, , t]) => t);
	return t1.concat(t2);
};
