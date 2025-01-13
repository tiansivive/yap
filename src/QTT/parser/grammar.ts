// Generated automatically by nearley, version 2.20.1
// http://github.com/Hardmath123/nearley
// Bypasses TS6133. Allow declared but unused functions.
// @ts-ignore
function id(d: any[]): any {
	return d[0];
}
declare var NL: any;
declare var hole: any;
declare var ws: any;
declare var op: any;
declare var lparens: any;
declare var rparens: any;
declare var colon: any;
declare var backslash: any;
declare var arrow: any;
declare var hash: any;
declare var fatArrow: any;
declare var semicolon: any;
declare var lbrace: any;
declare var rbrace: any;
declare var equals: any;
declare var variable: any;
declare var bar: any;
declare var dot: any;
declare var number: any;
declare var string: any;

// Moo lexer documention is here:
// https://github.com/no-context/moo

import moo from "moo";
import Shared from "../shared";
import * as Src from "./src";
import * as Con from "./constructors";

const lexer = moo.compile({
	number: /[0-9]+/,
	variable: {
		match: /[a-zA-Z][a-zA-Z0-9]*/,
		type: moo.keywords({
			ret: "return",
			dec: "let",
			match: "match",
			Type: "Type",
			Unit: "Unit",
		}),
	},
	string: /"(?:\\["bfnrt\/\\]|\\u[a-fA-F0-9]{4}|[^"\\])*"/,
	dot: /\./,
	equals: /\=(?!>)/,
	backslash: /\\/,
	arrow: /->/,
	fatArrow: /\=>/,
	op: /[\+\-\*\/]/,
	ws: /[ \t]+/,
	lparens: /\(/,
	rparens: /\)/,
	lbrace: /\{/,
	rbrace: /\}/,
	semicolon: /\;/,
	colon: /\:/,
	bar: /\|/,
	hash: /#/,
	hole: /_/,
	NL: { match: /\n+/, lineBreaks: true },
});

interface NearleyToken {
	value: any;
	[key: string]: any;
}

interface NearleyLexer {
	reset: (chunk: string, info: any) => void;
	next: () => NearleyToken | undefined;
	save: () => any;
	formatError: (token: never) => string;
	has: (tokenType: string) => boolean;
}

interface NearleyRule {
	name: string;
	symbols: NearleySymbol[];
	postprocess?: (d: any[], loc?: number, reject?: {}) => any;
}

type NearleySymbol =
	| string
	| { literal: any }
	| { test: (token: any) => boolean };

interface Grammar {
	Lexer: NearleyLexer | undefined;
	ParserRules: NearleyRule[];
	ParserStart: string;
}

const grammar: Grammar = {
	Lexer: lexer,
	ParserRules: [
		{ name: "Script$ebnf$1", symbols: ["Statement"] },
		{
			name: "Script$ebnf$1",
			symbols: ["Script$ebnf$1", "Statement"],
			postprocess: (d) => d[0].concat([d[1]]),
		},
		{
			name: "Script$ebnf$2",
			symbols: [lexer.has("NL") ? { type: "NL" } : NL],
			postprocess: id,
		},
		{ name: "Script$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "Script",
			symbols: ["Script$ebnf$1", "Script$ebnf$2"],
			postprocess: (d) => ({ type: "script", script: d[0] }),
		},
		{ name: "Script", symbols: ["Expr"], postprocess: id },
		{ name: "Expr", symbols: ["Lambda"], postprocess: id },
		{ name: "Expr", symbols: ["Ann"], postprocess: id },
		{ name: "Expr", symbols: ["Match"], postprocess: id },
		{ name: "Expr", symbols: ["Block"], postprocess: id },
		{ name: "Expr", symbols: ["App"], postprocess: id },
		{ name: "Expr", symbols: ["Pi"], postprocess: id },
		{
			name: "Expr",
			symbols: [lexer.has("hole") ? { type: "hole" } : hole],
			postprocess: Con.Hole,
		},
		{
			name: "App",
			symbols: ["App", lexer.has("ws") ? { type: "ws" } : ws, "Atom"],
			postprocess: Con.Application,
		},
		{
			name: "App$ebnf$1",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "App$ebnf$1", symbols: [], postprocess: () => null },
		{
			name: "App$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "App$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "App",
			symbols: [
				"App",
				"App$ebnf$1",
				lexer.has("op") ? { type: "op" } : op,
				"App$ebnf$2",
				"Atom",
			],
			postprocess: Con.Operation,
		},
		{ name: "App", symbols: ["Atom"], postprocess: id },
		{ name: "Atom", symbols: ["Literal"], postprocess: Con.Lit },
		{ name: "Atom", symbols: ["Identifier"], postprocess: Con.Var },
		{ name: "Atom$macrocall$2", symbols: ["Expr"] },
		{
			name: "Atom$macrocall$1$ebnf$1",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Atom$macrocall$1$ebnf$1", symbols: [], postprocess: () => null },
		{
			name: "Atom$macrocall$1$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Atom$macrocall$1$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "Atom$macrocall$1",
			symbols: [
				lexer.has("lparens") ? { type: "lparens" } : lparens,
				"Atom$macrocall$1$ebnf$1",
				"Atom$macrocall$2",
				"Atom$macrocall$1$ebnf$2",
				lexer.has("rparens") ? { type: "rparens" } : rparens,
			],
			postprocess: Con.unwrapParenthesis,
		},
		{ name: "Atom", symbols: ["Atom$macrocall$1"], postprocess: id },
		{
			name: "Ann$ebnf$1",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Ann$ebnf$1", symbols: [], postprocess: () => null },
		{
			name: "Ann$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Ann$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "Ann",
			symbols: [
				"Expr",
				"Ann$ebnf$1",
				lexer.has("colon") ? { type: "colon" } : colon,
				"Ann$ebnf$2",
				"Atom",
			],
			postprocess: Con.Annotation,
		},
		{
			name: "Lambda",
			symbols: [
				lexer.has("backslash") ? { type: "backslash" } : backslash,
				"Param",
				lexer.has("ws") ? { type: "ws" } : ws,
				lexer.has("arrow") ? { type: "arrow" } : arrow,
				lexer.has("ws") ? { type: "ws" } : ws,
				"Expr",
			],
			postprocess: Con.Lambda,
		},
		{
			name: "Lambda",
			symbols: [
				lexer.has("backslash") ? { type: "backslash" } : backslash,
				lexer.has("hash") ? { type: "hash" } : hash,
				"Param",
				lexer.has("ws") ? { type: "ws" } : ws,
				lexer.has("fatArrow") ? { type: "fatArrow" } : fatArrow,
				lexer.has("ws") ? { type: "ws" } : ws,
				"Expr",
			],
			postprocess: Con.Lambda,
		},
		{ name: "Param", symbols: ["Identifier"], postprocess: Con.Param },
		{
			name: "Param$ebnf$1",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Param$ebnf$1", symbols: [], postprocess: () => null },
		{
			name: "Param$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Param$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "Param",
			symbols: [
				"Identifier",
				"Param$ebnf$1",
				lexer.has("colon") ? { type: "colon" } : colon,
				"Param$ebnf$2",
				"Expr",
			],
			postprocess: Con.Param,
		},
		{ name: "Param$macrocall$2", symbols: ["Param"] },
		{
			name: "Param$macrocall$1$ebnf$1",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Param$macrocall$1$ebnf$1", symbols: [], postprocess: () => null },
		{
			name: "Param$macrocall$1$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Param$macrocall$1$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "Param$macrocall$1",
			symbols: [
				lexer.has("lparens") ? { type: "lparens" } : lparens,
				"Param$macrocall$1$ebnf$1",
				"Param$macrocall$2",
				"Param$macrocall$1$ebnf$2",
				lexer.has("rparens") ? { type: "rparens" } : rparens,
			],
			postprocess: Con.unwrapParenthesis,
		},
		{ name: "Param", symbols: ["Param$macrocall$1"], postprocess: id },
		{
			name: "Pi$ebnf$1",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Pi$ebnf$1", symbols: [], postprocess: () => null },
		{
			name: "Pi",
			symbols: [
				"Expr",
				"Pi$ebnf$1",
				lexer.has("arrow") ? { type: "arrow" } : arrow,
				lexer.has("ws") ? { type: "ws" } : ws,
				"Atom",
			],
			postprocess: Con.Pi("Explicit"),
		},
		{
			name: "Pi$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Pi$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "Pi",
			symbols: [
				"Expr",
				"Pi$ebnf$2",
				lexer.has("fatArrow") ? { type: "fatArrow" } : fatArrow,
				lexer.has("ws") ? { type: "ws" } : ws,
				"Atom",
			],
			postprocess: Con.Pi("Implicit"),
		},
		{ name: "Block$macrocall$2$ebnf$1", symbols: [] },
		{
			name: "Block$macrocall$2$ebnf$1",
			symbols: ["Block$macrocall$2$ebnf$1", "Statement"],
			postprocess: (d) => d[0].concat([d[1]]),
		},
		{ name: "Block$macrocall$2$ebnf$2$macrocall$2", symbols: ["Return"] },
		{
			name: "Block$macrocall$2$ebnf$2$macrocall$1$ebnf$1",
			symbols: [lexer.has("NL") ? { type: "NL" } : NL],
			postprocess: id,
		},
		{
			name: "Block$macrocall$2$ebnf$2$macrocall$1$ebnf$1",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Block$macrocall$2$ebnf$2$macrocall$1$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{
			name: "Block$macrocall$2$ebnf$2$macrocall$1$ebnf$2",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Block$macrocall$2$ebnf$2$macrocall$1$ebnf$3",
			symbols: [lexer.has("NL") ? { type: "NL" } : NL],
			postprocess: id,
		},
		{
			name: "Block$macrocall$2$ebnf$2$macrocall$1$ebnf$3",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Block$macrocall$2$ebnf$2$macrocall$1$ebnf$4",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{
			name: "Block$macrocall$2$ebnf$2$macrocall$1$ebnf$4",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Block$macrocall$2$ebnf$2$macrocall$1",
			symbols: [
				"Block$macrocall$2$ebnf$2$macrocall$1$ebnf$1",
				"Block$macrocall$2$ebnf$2$macrocall$1$ebnf$2",
				"Block$macrocall$2$ebnf$2$macrocall$2",
				"Block$macrocall$2$ebnf$2$macrocall$1$ebnf$3",
				"Block$macrocall$2$ebnf$2$macrocall$1$ebnf$4",
				lexer.has("semicolon") ? { type: "semicolon" } : semicolon,
			],
			postprocess: Con.unwrapStatement,
		},
		{
			name: "Block$macrocall$2$ebnf$2",
			symbols: ["Block$macrocall$2$ebnf$2$macrocall$1"],
			postprocess: id,
		},
		{ name: "Block$macrocall$2$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "Block$macrocall$2",
			symbols: ["Block$macrocall$2$ebnf$1", "Block$macrocall$2$ebnf$2"],
		},
		{
			name: "Block$macrocall$1$ebnf$1",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Block$macrocall$1$ebnf$1", symbols: [], postprocess: () => null },
		{
			name: "Block$macrocall$1$ebnf$2",
			symbols: [lexer.has("NL") ? { type: "NL" } : NL],
			postprocess: id,
		},
		{ name: "Block$macrocall$1$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "Block$macrocall$1",
			symbols: [
				lexer.has("lbrace") ? { type: "lbrace" } : lbrace,
				"Block$macrocall$2",
				"Block$macrocall$1$ebnf$1",
				"Block$macrocall$1$ebnf$2",
				lexer.has("rbrace") ? { type: "rbrace" } : rbrace,
			],
			postprocess: Con.unwrapCurlyBraces,
		},
		{ name: "Block", symbols: ["Block$macrocall$1"], postprocess: Con.Block },
		{ name: "Statement$macrocall$2", symbols: ["Expr"] },
		{
			name: "Statement$macrocall$1$ebnf$1",
			symbols: [lexer.has("NL") ? { type: "NL" } : NL],
			postprocess: id,
		},
		{
			name: "Statement$macrocall$1$ebnf$1",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Statement$macrocall$1$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{
			name: "Statement$macrocall$1$ebnf$2",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Statement$macrocall$1$ebnf$3",
			symbols: [lexer.has("NL") ? { type: "NL" } : NL],
			postprocess: id,
		},
		{
			name: "Statement$macrocall$1$ebnf$3",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Statement$macrocall$1$ebnf$4",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{
			name: "Statement$macrocall$1$ebnf$4",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Statement$macrocall$1",
			symbols: [
				"Statement$macrocall$1$ebnf$1",
				"Statement$macrocall$1$ebnf$2",
				"Statement$macrocall$2",
				"Statement$macrocall$1$ebnf$3",
				"Statement$macrocall$1$ebnf$4",
				lexer.has("semicolon") ? { type: "semicolon" } : semicolon,
			],
			postprocess: Con.unwrapStatement,
		},
		{
			name: "Statement",
			symbols: ["Statement$macrocall$1"],
			postprocess: Con.Expr,
		},
		{ name: "Statement$macrocall$4", symbols: ["Letdec"] },
		{
			name: "Statement$macrocall$3$ebnf$1",
			symbols: [lexer.has("NL") ? { type: "NL" } : NL],
			postprocess: id,
		},
		{
			name: "Statement$macrocall$3$ebnf$1",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Statement$macrocall$3$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{
			name: "Statement$macrocall$3$ebnf$2",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Statement$macrocall$3$ebnf$3",
			symbols: [lexer.has("NL") ? { type: "NL" } : NL],
			postprocess: id,
		},
		{
			name: "Statement$macrocall$3$ebnf$3",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Statement$macrocall$3$ebnf$4",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{
			name: "Statement$macrocall$3$ebnf$4",
			symbols: [],
			postprocess: () => null,
		},
		{
			name: "Statement$macrocall$3",
			symbols: [
				"Statement$macrocall$3$ebnf$1",
				"Statement$macrocall$3$ebnf$2",
				"Statement$macrocall$4",
				"Statement$macrocall$3$ebnf$3",
				"Statement$macrocall$3$ebnf$4",
				lexer.has("semicolon") ? { type: "semicolon" } : semicolon,
			],
			postprocess: Con.unwrapStatement,
		},
		{ name: "Statement", symbols: ["Statement$macrocall$3"], postprocess: id },
		{
			name: "Return",
			symbols: [
				{ literal: "return" },
				lexer.has("ws") ? { type: "ws" } : ws,
				"Expr",
			],
			postprocess: Con.Return,
		},
		{
			name: "Letdec$ebnf$1",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Letdec$ebnf$1", symbols: [], postprocess: () => null },
		{
			name: "Letdec$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Letdec$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "Letdec",
			symbols: [
				{ literal: "let" },
				lexer.has("ws") ? { type: "ws" } : ws,
				"Identifier",
				"Letdec$ebnf$1",
				lexer.has("equals") ? { type: "equals" } : equals,
				"Letdec$ebnf$2",
				"Expr",
			],
			postprocess: Con.LetDec,
		},
		{
			name: "Letdec$ebnf$3",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Letdec$ebnf$3", symbols: [], postprocess: () => null },
		{
			name: "Letdec$ebnf$4",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Letdec$ebnf$4", symbols: [], postprocess: () => null },
		{
			name: "Letdec$ebnf$5",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Letdec$ebnf$5", symbols: [], postprocess: () => null },
		{
			name: "Letdec$ebnf$6",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Letdec$ebnf$6", symbols: [], postprocess: () => null },
		{
			name: "Letdec",
			symbols: [
				{ literal: "let" },
				lexer.has("ws") ? { type: "ws" } : ws,
				"Identifier",
				"Letdec$ebnf$3",
				lexer.has("colon") ? { type: "colon" } : colon,
				"Letdec$ebnf$4",
				"Expr",
				"Letdec$ebnf$5",
				lexer.has("equals") ? { type: "equals" } : equals,
				"Letdec$ebnf$6",
				"Expr",
			],
			postprocess: Con.LetDec,
		},
		{
			name: "Identifier",
			symbols: [lexer.has("variable") ? { type: "variable" } : variable],
			postprocess: Con.Name,
		},
		{ name: "Match$ebnf$1", symbols: ["Alt"] },
		{
			name: "Match$ebnf$1",
			symbols: ["Match$ebnf$1", "Alt"],
			postprocess: (d) => d[0].concat([d[1]]),
		},
		{
			name: "Match",
			symbols: [
				{ literal: "match" },
				lexer.has("ws") ? { type: "ws" } : ws,
				"Expr",
				"Match$ebnf$1",
			],
			postprocess: (d) => ({
				type: "match",
				scrutinee: d[2],
				alternatives: d[3],
			}),
		},
		{
			name: "Alt$ebnf$1",
			symbols: [lexer.has("NL") ? { type: "NL" } : NL],
			postprocess: id,
		},
		{ name: "Alt$ebnf$1", symbols: [], postprocess: () => null },
		{
			name: "Alt$ebnf$2",
			symbols: [lexer.has("ws") ? { type: "ws" } : ws],
			postprocess: id,
		},
		{ name: "Alt$ebnf$2", symbols: [], postprocess: () => null },
		{
			name: "Alt",
			symbols: [
				"Alt$ebnf$1",
				"Alt$ebnf$2",
				lexer.has("bar") ? { type: "bar" } : bar,
				lexer.has("ws") ? { type: "ws" } : ws,
				"Pattern",
				lexer.has("ws") ? { type: "ws" } : ws,
				lexer.has("arrow") ? { type: "arrow" } : arrow,
				lexer.has("ws") ? { type: "ws" } : ws,
				"Expr",
			],
			postprocess: (d) => ({ type: "alternative", pattern: d[4], body: d[8] }),
		},
		{
			name: "Pattern",
			symbols: ["Identifier"],
			postprocess: (d) => ({ type: "Var", binding: d[0] }),
		},
		{
			name: "Literal",
			symbols: ["String"],
			postprocess: ([s]) => Shared.String(s),
		},
		{
			name: "Literal",
			symbols: ["Number"],
			postprocess: ([n]) => Shared.Num(n),
		},
		{
			name: "Literal",
			symbols: [{ literal: "Type" }],
			postprocess: () => Shared.Type(),
		},
		{
			name: "Literal",
			symbols: [{ literal: "Unit" }],
			postprocess: () => Shared.Unit(),
		},
		{
			name: "Number",
			symbols: ["Int", lexer.has("dot") ? { type: "dot" } : dot, "Int"],
			postprocess: (d) => parseFloat(d.join("")),
		},
		{ name: "Number", symbols: ["Int"], postprocess: (d) => parseInt(d) },
		{
			name: "Int",
			symbols: [lexer.has("number") ? { type: "number" } : number],
			postprocess: id,
		},
		{
			name: "String",
			symbols: [lexer.has("string") ? { type: "string" } : string],
			postprocess: (d) => d[0].value.slice(1, -1),
		},
	],
	ParserStart: "Script",
};

export default grammar;
