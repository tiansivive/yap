import { Postprocessor, PostProcessor } from "nearley";

import type { Statement, Term, Variable, Row } from "./terms";
import * as Src from "./terms";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";

import { Token } from "moo";
import { Literal } from "@yap/shared/literals";
import * as L from "@yap/shared/literals";
import { Implicitness } from "@yap/shared/implicitness";
import * as P from "@yap/shared/provenance";
import * as Null from "@yap/utils";

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
export const Name: PostProcessor<[Token], Variable> = tok => {
	return F.pipe(
		tok,
		sourceLoc,
		Sourced.fold<unknown, Variable>((value, location) => {
			if (value === undefined || value === null) {
				throw new Error("Expected non-empty value for var name");
			}

			if (typeof value === "string") {
				return { type: "name", value, location };
			}

			return { type: "name", value: JSON.stringify(value), location };
			// throw new Error("Expected string value for var name");
		}),
	);
};

export const Label: PostProcessor<[Colon, Token], Variable> = ([, tok]) => {
	return F.pipe(
		[tok],
		sourceLoc,
		Sourced.fold<unknown, Variable>((value, location) => {
			if (typeof value !== "string") {
				throw new Error("Expected string value for var name");
			}
			return { type: "label", value, location };
		}),
	);
};

export const Str: PostProcessor<[Sourced<string>], Sourced<Literal>> = F.flow(
	NEA.head,
	Sourced.map(value => ({ type: "String", value })),
);
export const Num: PostProcessor<[Sourced<number>], Sourced<Literal>> = F.flow(
	NEA.head,
	Sourced.map(value => {
		return { type: "Num", value };
	}),
);
export const Bool: PostProcessor<[Sourced<boolean>], Sourced<Literal>> = F.flow(
	NEA.head,
	Sourced.map(value => {
		return { type: "Bool", value };
	}),
);

export const True = (tok: Token): Sourced<boolean> => [true, { from: loc(tok) }];
export const False = (tok: Token): Sourced<boolean> => [false, { from: loc(tok) }];

export const Type = (tok: Token): Sourced<Literal> => [L.Type(), { from: loc(tok) }];
export const Unit =
	(level: "value" | "type") =>
	(tok: Token): Sourced<Literal> => {
		const l = { from: loc(tok) };
		return level === "value" ? [L.unit(), l] : [L.Unit(), l];
	};

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
const App = (fn: Term, arg: Term, icit: Implicitness): Term => ({
	type: "application",
	fn,
	arg,
	icit,
	location: span(fn, arg),
});

type ExplicitApp = [Term, Whitespace, Term];
type ImplicitApp = [Term, Whitespace, Token, Term];
type Application<T> = T extends "Explicit" ? ExplicitApp : ImplicitApp;
export const Application: (icit: Implicitness) => PostProcessor<Application<typeof icit>, Term> = icit => (args: Application<typeof icit>) => {
	if (icit === "Explicit") {
		const [fn, , arg] = args as ExplicitApp;
		return App(fn, arg, icit);
	}
	const [fn, , , arg] = args as ImplicitApp;
	return App(fn, arg, icit);
};

export const Operation: PostProcessor<[Term, Whitespace, [Token], Whitespace, Term], Term> = data => {
	const [lhs, , [op], , rhs] = data;
	const op_ = Var([Name([op])]);
	return App(App(op_, lhs, "Explicit"), rhs, "Explicit");
};

/***********************************************************
 * Annotation processors
 ***********************************************************/
type Annotation = [] | [Token, Colon, Whitespace, Term];
//| [Token, Colon, Whitespace, [Q.Multiplicity], Whitespace, Term];

const Annotate = (term: Term, ann: Term): Term => ({
	type: "annotation",
	term,
	ann,
	location: span(term, ann),
});

export const Annotation = ([term, ...rest]: [Term, ...Annotation]): Term => {
	if (rest.length === 0) {
		throw new Error("Expected annotation");
	}

	const [, , , ann] = rest;
	return Annotate(term, ann);

	// const q = rest[3][0];
	// const ann = rest[5];
	// return Annotate(term, ann, q);
};

/***********************************************************
 * Lambda processors
 ***********************************************************/

type Implicit = [Backslash, Param[], Whitespace, Arrow, Whitespace, Term];
type Explicit = [Backslash, Param[], Whitespace, Arrow, Whitespace, Term];
type Param = { type: "param"; binding: Variable; annotation?: Term };

const Lam = (icit: Implicitness, params: Param[], body: Term): Term => {
	return params.reduceRight((acc, param) => {
		return {
			type: "lambda",
			icit,
			variable: param.binding.value,
			annotation: param.annotation,
			body: acc,
			location: locSpan(param.binding.location, acc.location),
		};
	}, body);
};

export const Lambda: (icit: Implicitness) => PostProcessor<[Backslash, [Param, [Whitespace, Param][]], Whitespace, Arrow, Whitespace, Term], Term> =
	icit => args => {
		const [, raw, , , , body] = args;

		const params = [raw[0], ...raw[1].map(([, p]) => p)];
		return Lam(icit, params, body);
	};

export const Pi: (icit: Implicitness) => PostProcessor<[Term, Whitespace, Token, Whitespace, Term], Term> =
	icit =>
	([expr, , arr, , body]) => {
		if (expr.type === "annotation") {
			const { term, ann } = expr;

			if (term.type !== "var") {
				throw new Error("Expected variable in Pi binding");
			}

			if (ann.type === "annotation") {
				throw new Error("No cumulative annotations in Pi bindings allowed");
			}

			return { type: "pi", icit, variable: term.variable.value, annotation: ann, body, location: span(expr, body) };
		}

		return { type: "arrow", lhs: expr, rhs: body, icit, location: span(expr, body) };
	};

export const Param = (p: [Variable, ...Annotation]): Param => {
	const [binding, ...ann] = p;
	if (ann.length === 0) {
		return {
			type: "param",
			binding,
		};
	}

	const [, , , term] = ann;
	return {
		type: "param",
		binding,
		annotation: term,
	};
};

/***********************************************************
 * Row related processors
 ***********************************************************/
type KeyVal = Sourced<[string, Term]>;

export const keyval = (pair: [Variable, Whitespace, Colon, Whitespace, Term]): KeyVal => {
	const [v, , , , value] = pair;
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

export const struct: PostProcessor<[[KeyVal[], Variable?]], Term> = ([[pairs, v]]) => {
	if (pairs.length === 0) {
		throw new Error("Expected at least one key-value pair in struct");
	}

	const last = pairs[pairs.length - 1];
	const tail: Row = v ? { type: "variable", variable: v, location: v.location } : { type: "empty", location: last[1] };

	const row = pairs.reduceRight<Row>((acc, [[label, value], location]) => ({ type: "extension", label, value, row: acc, location }), tail);
	return { type: "struct", row, location: locSpan(pairs[0][1], tail.location) };
};

export const dict: PostProcessor<[[Space, [Space, Term], Space, Colon, Space, Term]], Term> = ([data]) => {
	const [, [, index], , , , term] = data;
	return { type: "dict", index, term, location: locSpan(index.location, term.location) };
};

export const tagged: PostProcessor<[Colon, Variable, Whitespace, Term], Term> = ([tok, v, , tm]) => {
	return {
		type: "tagged",
		tag: v.value,
		term: tm,
		location: locSpan({ from: loc(tok) }, tm.location),
	};
};

type Tagged = Extract<Term, { type: "tagged" }>;
export const variant = (data: [Bar, Tagged[]] | [Tagged[]]): Term => {
	const mkVariant = (terms: Tagged[]): Term => {
		const last = terms[terms.length - 1];
		const tail: Row = { type: "empty", location: last.location };
		const row = terms.reduceRight<Row>((acc, tm) => {
			return { type: "extension", label: tm.tag, value: tm.term, row: acc, location: tm.location };
		}, tail);
		return { type: "variant", row, location: locSpan(terms[0].location, tail.location) };
	};
	if (data.length === 1) {
		return mkVariant(data[0]);
	}
	return mkVariant(data[1]);
};

export const tuple: PostProcessor<[[Term[], Variable?]], Term> = ([[terms, v]]) => {
	if (terms.length === 0) {
		throw new Error("Expected at least one term in tuple");
	}
	const last = terms[terms.length - 1];
	const tail: Row = v ? { type: "variable", variable: v, location: v.location } : { type: "empty", location: last.location };
	return {
		type: "tuple",
		row: terms.reduceRight<Row>((row, value, i) => ({ type: "extension", label: i.toString(), value, row, location: value.location }), tail),
		location: locSpan(terms[0].location, last.location),
	};
};

export const emptyList = ([location]: [P.Location]): Term => ({ type: "list", elements: [], location });

export const list: PostProcessor<[[Term[], Variable?]], Term> = ([[terms, v]]) => {
	if (terms.length === 0) {
		throw new Error("Expected at least one term in list");
	}
	const last = terms[terms.length - 1];

	return {
		type: "list",
		elements: terms,
		rest: v,
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
		return Lam("Explicit", [{ type: "param", binding }], project(label, Var([binding])));
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
		return Lam("Explicit", [{ type: "param", binding }], body);
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

export const Alternative: PostProcessor<[Space, Bar, Space, Src.Pattern, Space, Arrow, Space, Term], Src.Alternative> = alt => {
	const bar = alt[1];
	const pat = alt[3];
	const term = alt[7];
	return {
		pattern: pat,
		term,
		location: locSpan({ from: loc(bar) }, term.location),
	};
};

/***********************************************************
 * Delimited Continuations processors
 ***********************************************************/

export const Reset: PostProcessor<[Keyword, Whitespace, Term, Whitespace, Term], Term> = ([tok, , handler, , term]) => {
	return {
		type: "reset",
		handler,
		term,
		location: locSpan({ from: loc(tok) }, term.location),
	};
};

export const Shift: PostProcessor<[Keyword, Whitespace, Term], Term> = ([tok, , term]) => {
	return {
		type: "shift",
		term,
		location: locSpan({ from: loc(tok) }, term.location),
	};
};

type PatKeyVal = [string, Src.Pattern];
export const keyvalPat = (pair: [Variable, Whitespace, Colon, Whitespace, Src.Pattern]): PatKeyVal => {
	const [v, , , , pat] = pair;
	return [v.value, pat];
};

type PatTagged = [string, Src.Pattern];
export const taggedPat = ([tok, v, , pat]: [Hash, Variable, Space, Src.Pattern]): PatTagged => {
	return [v.value, pat];
};

type RowPat = R.Row<Src.Pattern, Variable>;
export const Pattern = {
	Var: ([value]: [Variable]): Src.Pattern => ({ type: "var", value }),
	Lit: ([[value]]: [Sourced<Literal>]): Src.Pattern => ({ type: "lit", value }),
	Tuple: ([[terms, v]]: [[Src.Pattern[], Variable?]]): Src.Pattern => {
		const tail: RowPat = !v ? { type: "empty" } : { type: "variable", variable: v };
		const row = terms.reduceRight<RowPat>((row, value, i) => ({ type: "extension", label: i.toString(), value, row }), tail);
		return { type: "tuple", row };
	},
	Struct: ([[pairs, v]]: [[PatKeyVal[], Variable?]]): Src.Pattern => {
		const tail: RowPat = !v ? { type: "empty" } : { type: "variable", variable: v };
		const row = pairs.reduceRight<RowPat>((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), tail);
		return { type: "struct", row };
	},
	List: ([[elements, v]]: [[Src.Pattern[], Variable?]]): Src.Pattern => {
		return { type: "list", elements, rest: v };
	},
	Row: ([[pairs, v]]: [[PatKeyVal[], Variable?]]): Src.Pattern => {
		const tail: RowPat = !v ? { type: "empty" } : { type: "variable", variable: v };
		const row = pairs.reduceRight<RowPat>((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), tail);
		return { type: "row", row };
	},

	Variant: ([pats, last]: [[PatTagged, Space, Bar, Space][], PatTagged]): Src.Pattern => {
		const tail: RowPat = { type: "extension", label: last[0], value: last[1], row: { type: "empty" } };
		const row = pats.reduceRight<RowPat>((acc, [[label, value]]) => ({ type: "extension", label, value, row: acc }), tail);
		return { type: "variant", row };
	},
	Wildcard: ([tok]: [Token]): Src.Pattern => ({ type: "wildcard" }),

	Empty: {
		List: (): Src.Pattern => ({ type: "list", elements: [] }),
		Struct: (): Src.Pattern => ({ type: "struct", row: { type: "empty" } }),
	},
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

export const Return: PostProcessor<[Space, Keyword, Whitespace, Term, SemiColon], Term> = d => d[3];

export const Expr: PostProcessor<[Term], Statement> = ([value]) => ({ type: "expression", value, location: value.location });

export const Using: PostProcessor<[Keyword, Space, Term], Statement> = data => {
	if (data.length !== 3) {
		throw new Error("Expected 4 elements in using statement. Renaming not yet implemented");
	}
	const [, , term] = data;
	return { type: "using", value: term, location: term.location };
};

export const Foreign: PostProcessor<[Keyword, Space, Variable, Space, Token, Space, Term], Statement> = data => {
	const [, , variable, , , , term] = data;
	return { type: "foreign", variable: variable.value, annotation: term, location: locSpan(variable.location, term.location) };
};

type LetDec = [Keyword, Whitespace, Variable, ...Annotation, Space, Equals, Whitespace, Term];
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

	const q = rest[3][0];
	const ann = rest[5];
	const value = rest[9];
	return letdec(variable, value, ann, q);
};

/***********************************************************
 * Modal processors
 ***********************************************************/

type Modal =
	| [[Q.Multiplicity], Whitespace, Term]
	| [[Q.Multiplicity], Whitespace, Term, Whitespace, LAngle, Whitespace, Term, RAngle]
	| [Term, Whitespace, [Whitespace, Term]];

export const Modal: PostProcessor<Modal, Term> = (data: Modal): Term => {
	if (data.length === 8) {
		const [[q], , term, , , , liquid] = data;

		return { type: "modal", term, modalities: { quantity: q, liquid }, location: term.location };
	}

	if (Array.isArray(data[0])) {
		const [[q], , term] = data as [[Q.Multiplicity], Whitespace, Term];
		return { type: "modal", term, modalities: { quantity: q }, location: term.location };
	}

	const [term, , [, liquid]] = data as [Term, Whitespace, [Whitespace, Term]];
	return { type: "modal", term, modalities: { liquid }, location: locSpan(term.location, liquid.location) };
};

/***********************************************************
 * Module processors
 ***********************************************************/

export const script: PostProcessor<[Statement[], SemiColon, Newline], Src.Script> = ([statements]) => {
	return { type: "script", script: statements };
};

export const module_: PostProcessor<[Space, Src.Export, Src.Import[], Newline, Src.Script], Src.Module> = ([, exports, imports, , script]) => {
	return { type: "module", imports, exports, content: script };
};

export const exportSome: PostProcessor<[Keyword, Whitespace, Variable[], SemiColon], Src.Export> = ([, , variables]) => {
	return { type: "explicit", names: variables.map(v => v.value) };
};

export const exportAll: PostProcessor<[Keyword, Whitespace, Token, SemiColon], Src.Export> = () => {
	return { type: "*" };
};

export const importAll: PostProcessor<[Space, Keyword, Whitespace, Sourced<string>, SemiColon], Src.Import> = ([, , , str]) => {
	return { type: "*", filepath: str[0], hiding: [] };
};

export const importSome: PostProcessor<[Space, Keyword, Whitespace, Sourced<string>, Whitespace, Variable[], SemiColon], Src.Import> = ([
	,
	,
	,
	str,
	,
	vars,
]) => {
	return { type: "explicit", filepath: str[0], names: vars.map(v => v.value) };
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

export const many: <T>(arg: [Array<[Space, T[], Space, Token]>, Space, T]) => T[] = arg => {
	const [arr, , t2] = arg;

	const t1 = arr.flatMap(([, t]) => t);
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
type Space = Token;
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
