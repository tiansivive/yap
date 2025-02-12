import { Postprocessor, PostProcessor } from "nearley";

import type { Statement, Term, Variable, Row } from "./terms";
import * as Src from "./terms";
import * as Q from "@qtt/shared/modalities/multiplicity";
import * as R from "@qtt/shared/rows";

import { Token } from "moo";
import { Literal } from "@qtt/shared/literals";
import * as L from "@qtt/shared/literals";
import { Implicitness } from "@qtt/shared/implicitness";
import * as P from "@qtt/shared/provenance";
import * as Null from "../../utils/Nullable";

import * as F from "fp-ts/function";
import * as NEA from "fp-ts/NonEmptyArray";

type Sourced<T> = [T, P.Location];
const Sourced = {
	of: <T>(value: T, location: P.Location): Sourced<T> => [value, location],
	map:
		<A, B>(f: (a: A) => B) =>
		([a, loc]: Sourced<A>): Sourced<B> => [f(a), loc],
	located:
		<A, B>(f: (a: A) => B) =>
		([a, loc]: Sourced<A>): P.WithLocation<B> => ({ ...f(a), location: loc }),
	fold:
		<A, B>(f: (a: A, loc: P.Location) => B) =>
		([a, loc]: Sourced<A>): B =>
			f(a, loc),
};

/***********************************************************
 * Primitive processors
 ***********************************************************/
export const Name: PostProcessor<[Token], Variable> = tok =>
	F.pipe(
		tok,
		sourceLoc,
		Sourced.fold<unknown, Variable>((value, location) => {
			if (typeof value !== "string") {
				throw new Error("Expected string value for var name");
			}
			return { type: "name", value, location };
		}),
	);

export const Str: PostProcessor<[Sourced<string>], Sourced<Literal>> = F.flow(
	NEA.head,
	Sourced.map(value => ({ type: "String", value })),
);
export const Num: PostProcessor<[Sourced<number>], Sourced<Literal>> = F.flow(
	NEA.head,
	Sourced.map(value => ({ type: "Num", value })),
);

export const Type = (tok: Token): Sourced<Literal> => [L.Type(), { from: loc(tok) }];
export const Unit = (tok: Token): Sourced<Literal> => [L.Unit(), { from: loc(tok) }];
export const LitRow = (tok: Token): Sourced<Literal> => [L.Row(), { from: loc(tok) }];

export const Hole: PostProcessor<[Token], Term> = tok =>
	F.pipe(
		tok,
		sourceLoc,
		Sourced.located(() => ({ type: "hole" })),
	);

export const Lit: PostProcessor<[Sourced<Literal>], Term> = ([[lit, location]]) => ({ type: "lit", value: lit, location });

/***********************************************************
 * Var constructor
 ***********************************************************/
export const Var: PostProcessor<[Variable], Term> = ([v]) => ({ type: "var", variable: v, location: v.location });

/***********************************************************
 * Application processors
 ***********************************************************/
const App = (fn: Term, arg: Term): Term => ({
	type: "application",
	fn,
	arg,
	icit: "Explicit",
	location: span(fn, arg),
});
export const Application: PostProcessor<[Term, Whitespace, Term], Term> = ([fn, , arg]) => App(fn, arg);

export const Operation: PostProcessor<[Term, Whitespace, Token, Whitespace, Term], Term> = ([lhs, , op, , rhs]) => {
	const op_ = Var([Name([op])]);
	return App(App(op_, lhs), rhs);
};

/***********************************************************
 * Annotation processors
 ***********************************************************/
type Annotation = [Whitespace, Colon, Whitespace, Term] | [Whitespace, Colon, Whitespace, Q.Multiplicity, Whitespace, Term] | [];

const Annotate = (term: Term, ann: Term, multiplicity?: Q.Multiplicity): Term => ({
	type: "annotation",
	term,
	ann,
	multiplicity,
	location: span(term, ann),
});

export const Annotation = ([term, ...rest]: [Term, ...Annotation]): Term => {
	if (rest.length === 0) {
		throw new Error("Expected annotation");
	}

	if (rest.length === 4) {
		const [, , , ann] = rest;
		return Annotate(term, ann);
	}

	const q = rest[3];
	const ann = rest[5];
	return Annotate(term, ann, q);
};

/***********************************************************
 * Lambda processors
 ***********************************************************/

type Implicit = [Backslash, Hash, Param, Whitespace, Arrow, Whitespace, Term];
type Explicit = [Backslash, Param, Whitespace, Arrow, Whitespace, Term];
type Param = { type: "param"; binding: Variable; annotation?: Term; multiplicity?: Q.Multiplicity };

const Lam = (icit: Implicitness, param: Param, body: Term): Term => ({
	type: "lambda",
	icit,
	variable: param.binding.value,
	annotation: param.annotation,
	body,
	multiplicity: param.multiplicity,
	location: locSpan(param.binding.location, body.location),
});

export const Lambda: PostProcessor<Explicit, Term> | PostProcessor<Implicit, Term> = (data: Implicit | Explicit) => {
	if (data.length === 7) {
		const [, , param, , , , body] = data;
		return Lam("Implicit", param, body);
	}
	const [, param, , , , body] = data;
	return Lam("Explicit", param, body);
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

			return { type: "pi", icit, variable: term.variable.value, annotation: ann, body, multiplicity, location: span(expr, body) };
		}

		return { type: "arrow", lhs: expr, rhs: body, icit, location: span(expr, body) };
	};

export const Param = ([binding, ...ann]: [Variable, ...Annotation]): Param => {
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

/***********************************************************
 * Row related processors
 ***********************************************************/
type KeyVal = Sourced<[string, Term]>;

export const keyval = (pair: [Variable, Whitespace, Colon, Whitespace, Term] | [Variable, Whitespace, Colon, Colon, Whitespace, Term]): KeyVal => {
	if (pair.length === 5) {
		const [v, , , , value] = pair;
		return Sourced.of([v.value, value], locSpan(v.location, value.location));
	}

	const [v, , , , , value] = pair;
	return Sourced.of([v.value, value], locSpan(v.location, value.location));
};

export const emptyRow = ([location]: [P.Location]): Term => ({ type: "row", location, row: { ...R.Constructors.Empty(), location } });

export const row: PostProcessor<[[KeyVal[], Variable?]], Term> = ([[pairs, v]]): Term => {
	if (pairs.length === 0) {
		throw new Error("Expected at least one key-value pair in row");
	}

	const last = pairs[pairs.length - 1];
	const tail: Row = !v ? { type: "empty", location: last[1] } : { type: "variable", variable: v, location: v.location };
	const row = pairs.reduceRight<Row>((r, [[label, value], loc]) => ({ type: "extension", label, value, row: r, location: loc }), tail);

	return { type: "row", row, location: locSpan(pairs[0][1], tail.location) };
};

export const emptyStruct = ([location]: [P.Location]): Term => ({ type: "struct", location, row: { ...R.Constructors.Empty(), location } });

export const struct: PostProcessor<[[KeyVal[]]], Term> = ([[pairs]]) => {
	if (pairs.length === 0) {
		throw new Error("Expected at least one key-value pair in struct");
	}

	const last = pairs[pairs.length - 1];
	const tail: Row = { type: "empty", location: last[1] };

	const row = pairs.reduceRight<Row>((acc, [[label, value], location]) => ({ type: "extension", label, value, row: acc, location }), tail);
	return { type: "struct", row, location: locSpan(pairs[0][1], tail.location) };
};

export const emptySchema = ([location]: [P.Location]): Term => ({ type: "schema", location, row: { ...R.Constructors.Empty(), location } });

export const schema: PostProcessor<[[KeyVal[], Variable?]], Term> = ([[pairs, v]]) => {
	if (pairs.length === 0) {
		throw new Error("Expected at least one key-value pair in schema");
	}

	const last = pairs[pairs.length - 1];
	const tail: Row = !v ? { type: "empty", location: last[1] } : { type: "variable", variable: v, location: v.location };

	const row = pairs.reduceRight<Row>((acc, [[label, value], location]) => ({ type: "extension", label, value, row: acc, location }), tail);
	return { type: "schema", row, location: locSpan(pairs[0][1], tail.location) };
};

export const variant: PostProcessor<[Bar, KeyVal[]], Term> = ([, pairs]) => {
	if (pairs.length === 0) {
		throw new Error("Expected at least one key-value pair in variant");
	}

	const last = pairs[pairs.length - 1];
	const tail: Row = { type: "empty", location: last[1] };

	const row = pairs.reduceRight<Row>((acc, [[label, value], location]) => ({ type: "extension", label, value, row: acc, location }), tail);
	return { type: "variant", row, location: locSpan(pairs[0][1], tail.location) };
};

export const tuple: PostProcessor<[[Term[]]], Term> = ([[terms]]) => {
	if (terms.length === 0) {
		throw new Error("Expected at least one term in tuple");
	}
	const last = terms[terms.length - 1];

	return {
		type: "tuple",
		row: terms.reduceRight<Row>((row, value, i) => ({ type: "extension", label: i.toString(), value, row, location: value.location }), {
			type: "empty",
			location: last.location,
		}),
		location: locSpan(terms[0].location, last.location),
	};
};

export const list: PostProcessor<[[Term[]]], Term> = ([[terms]]) => {
	if (terms.length === 0) {
		throw new Error("Expected at least one term in list");
	}
	const last = terms[terms.length - 1];

	return {
		type: "list",
		elements: terms,
		location: locSpan(terms[0].location, last.location),
	};
};

/***********************************************************
 * Injection & Projection processors
 ***********************************************************/

export const Projection: PostProcessor<[Term, Dot, Variable] | [Dot, Variable], Term> = (input: [Term, Dot, Variable] | [Dot, Variable]) => {
	const project = (label: Variable, term: Term): Term => ({ type: "projection", label: label.value, term, location: locSpan(label.location, term.location) });

	if (input.length === 2) {
		const [tok, label] = input;
		const binding: Variable = { type: "name", value: "x", location: { from: loc(tok) } };
		return Lam("Explicit", { type: "param", binding }, project(label, Var([binding])));
	}
	const [term, , label] = input;
	return project(label, term);
};

type Injection = [Whitespace, Term, Whitespace, Bar, KeyVal[]] | [Whitespace, Bar, KeyVal[]];
export const Injection: PostProcessor<[Injection], Term> = ([inj]) => {
	const inject = ([[label, value], loc]: KeyVal, term: Term): Term => ({
		type: "injection",
		label,
		value,
		term,
		location: locSpan(loc, term.location),
	});

	if (inj.length === 3) {
		const [, tok, pairs] = inj;
		const binding: Variable = { type: "name", value: "x", location: { from: loc(tok) } };
		const body = pairs.reduce((tm, kv) => inject(kv, tm), Var([binding]));
		return Lam("Explicit", { type: "param", binding }, body);
	}

	const [, term, , , pairs] = inj;
	return pairs.reduce((tm, kv) => inject(kv, tm), term);
};

/***********************************************************
 * Pattern matching processors
 ***********************************************************/

export const Match: PostProcessor<[Keyword, Whitespace, Term, Src.Alternative[]], Term> = ([tok, , term, alts]) => {
	if (alts.length === 0) {
		throw new Error("Expected at least one alternative in pattern match");
	}
	return {
		type: "match",
		scrutinee: term,
		alternatives: alts,
		location: locSpan({ from: loc(tok) }, alts[alts.length - 1].location),
	};
};

export const Alternative: PostProcessor<[Newline, Whitespace, Bar, Whitespace, Src.Pattern, Whitespace, Arrow, Whitespace, Term], Src.Alternative> = alt => {
	const bar = alt[2];
	const pat = alt[4];
	const term = alt[8];
	return {
		pattern: pat,
		term,
		location: locSpan({ from: loc(bar) }, term.location),
	};
};

type PatKeyVal = [string, Src.Pattern];
export const keyvalPat = (pair: [Variable, Whitespace, Colon, Whitespace, Src.Pattern]): PatKeyVal => {
	const [v, , , , pat] = pair;
	return [v.value, pat];
};
export const Pattern: PostProcessor<[Variable | Sourced<Literal> | [PatKeyVal[], Variable?]], Src.Pattern> = ([p]) => {
	type RowPat = R.Row<Src.Pattern, Variable>;

	if (!Array.isArray(p)) {
		return Pats.Var(p);
	}

	if (Array.isArray(p[0])) {
		const [pairs, v] = p as [PatKeyVal[], Variable?];
		const tail: RowPat = !v ? { type: "empty" } : { type: "variable", variable: v };
		const row = pairs.reduceRight<RowPat>((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), tail);
		return Pats.Struct(row);
	}

	return Pats.Lit(p[0]);
};

const Pats = {
	Var: (value: Variable): Src.Pattern => ({ type: "var", value }),
	Lit: (value: Literal): Src.Pattern => ({ type: "lit", value }),
	Struct: (row: R.Row<Src.Pattern, Variable>): Src.Pattern => ({ type: "struct", row }),
};

/***********************************************************
 * Block processors
 ***********************************************************/

export const Block: PostProcessor<[[Statement[], SemiColon, Term?] | [Term]], Term> = ([input]) => {
	const block = (statements: Statement[], ret?: Term): Term => {
		if (statements.length === 0 && !ret) {
			throw new Error("Expected at least one statement in block");
		}

		const first = statements[0] || ret;
		const location = locSpan(first.location, ret?.location || statements[statements.length - 1].location);
		return { type: "block", statements, return: ret, location };
	};

	if (Array.isArray(input[0])) {
		const [statements, , ret] = input;
		return block(statements, ret || undefined); // Ensure ret is undefined and not null
	}

	const [ret] = input;
	return block([], ret);
};

export const Return: PostProcessor<[Newline, Whitespace, Keyword, Whitespace, Term, SemiColon], Term> = d => d[4];

export const Expr: PostProcessor<[Term], Statement> = ([value]) => ({ type: "expression", value, location: value.location });

type LetDec = [Keyword, Whitespace, Variable, ...Annotation, Whitespace, Equals, Whitespace, Term];
export const LetDec: PostProcessor<LetDec, Statement> = ([, , variable, ...rest]: LetDec) => {
	const letdec = (variable: Variable, value: Term, annotation?: Term, multiplicity?: Q.Multiplicity): Statement => ({
		type: "let",
		variable: variable.value,
		value,
		annotation,
		multiplicity,
		location: locSpan(variable.location, value.location),
	});

	if (rest.length === 4) {
		const [, , , value] = rest;
		return letdec(variable, value);
	}

	if (rest.length === 8) {
		const [, , , ann, , , , value] = rest;
		return letdec(variable, value, ann);
	}

	const q = rest[3];
	const ann = rest[5];
	const value = rest[9];
	return letdec(variable, value, ann, q);
};

/***********************************************************
 * Macro processors
 ***********************************************************/
export const empty: PostProcessor<Token[], P.Location> = toks => {
	const start = toks[0];
	const end = toks[toks.length - 1];

	return range(start, end);
};

export const unwrap: <T>(arg: [Token, T[], Whitespace, Token]) => Sourced<T> = arg => {
	const [l, [t], , r] = arg;
	return [t, range(l, r)];
};

export const many: <T>(arg: [Array<[Newline, Whitespace, T[], Newline, Whitespace, Token]>, Newline, Whitespace, T]) => T[] = arg => {
	const [arr, , , t2] = arg;

	const t1 = arr.flatMap(([, , t]) => t);
	return t1.concat(t2);
};

export const enclosed = <T>([[t]]: [[T]]): T => t;
export const extract = <T>([[t]]: [[T]]): T => t;

/***********************************************************
 * Location utilities
 ***********************************************************/
export const sourceLoc: (tok: [Token]) => Sourced<unknown> = ([tok]) => [tok.value, { from: loc(tok) }];

const loc = (tok: Token): P.LineCol => ({
	line: tok.line,
	column: tok.col,
	token: tok,
});

const range = (from: Token, to?: Token): P.Location => ({
	from: loc(from),
	to: Null.map(to, loc),
});

const span = (t1: Term, t2: Term): P.Location => ({
	from: t1.location.from,
	to: t2.location.to || t2.location.from,
});

const locSpan = (from: P.Location, to: P.Location): P.Location => ({
	from: from.from,
	to: to?.to || to?.from,
});

/***********************************************************
 * Token aliases
 ***********************************************************/
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
