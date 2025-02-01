import { Postprocessor, PostProcessor } from "nearley";

import type { Statement, Term, Variable, Row } from "./terms";
import * as Src from "./terms";
import * as Q from "@qtt/shared/modalities/multiplicity";

import { Token } from "moo";
import { Literal } from "@qtt/shared/literals";
import { Implicitness } from "@qtt/shared/implicitness";

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
	multiplicity?: Q.Multiplicity;
};

type KeyVal = [string, Term];
export const keyval = (pair: [Variable, Whitespace, Colon, Whitespace, Term] | [Variable, Whitespace, Colon, Colon, Whitespace, Term]): KeyVal => {
	if (pair.length === 5) {
		const [v, , , , value] = pair;
		return [v.value, value];
	}

	const [v, , , , , value] = pair;
	return [v.value, value];
};

export const emptyRow = (): Term => Src.Row({ type: "empty" });

export const row: PostProcessor<[[KeyVal[]], Variable?], Term> = ([[pairs], v]): Term => {
	const tail: Row = !v ? { type: "empty" } : { type: "variable", variable: v };
	const row = pairs.reduceRight<Row>((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), tail);
	return Src.Row(row);
};

export const emptyStruct = (): Term => Src.Struct({ type: "empty" });

export const struct: PostProcessor<[[KeyVal[]]], Term> = ([[pairs]]) => {
	const row = pairs.reduceRight<Row>((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), { type: "empty" });
	return Src.Struct(row);
};

export const emptySchema = (): Term => Src.Schema({ type: "empty" });

export const schema: PostProcessor<[[KeyVal[], Variable?]], Term> = ([[pairs, v]]) => {
	const tail: Row = !v ? { type: "empty" } : { type: "variable", variable: v };
	const row = pairs.reduceRight<Row>((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), tail);
	return Src.Schema(row);
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

export const Match: PostProcessor<[Keyword, Whitespace, Term, Src.Alternative[]], Term> = ([, , term, alts]) => Src.Match(term, alts);
export const Alternative: PostProcessor<[Newline, Whitespace, Bar, Whitespace, Src.Pattern, Whitespace, Arrow, Whitespace, Term], Src.Alternative> = ([
	,
	,
	,
	,
	pat,
	,
	,
	,
	term,
]) => Src.Alternative(pat, term);

export const Pattern: PostProcessor<[Variable | Literal], Src.Pattern> = ([p]) => {
	if (p.type === "name") {
		return Src.Patterns.Var(p);
	}

	return Src.Patterns.Lit(p);
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

type Annotation = [Whitespace, Colon, Whitespace, Term] | [Whitespace, Colon, Whitespace, Q.Multiplicity, Whitespace, Term] | [];

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
