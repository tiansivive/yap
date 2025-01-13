import { match, P } from "ts-pattern";

import * as F from "fp-ts/function";
import * as _ from "lodash";
import { evaluate } from "./evaluation/eval.js";

export type Term =
	| { tag: "Lit"; value: Literal }
	| { tag: "Var"; variable: Variable }
	| { tag: "Abs"; binder: Binder; body: Term }
	| { tag: "App"; func: Term; arg: Term }
	| { tag: "Ann"; term: Term; ann: Term }
	| { tag: "Refined"; term: Term; ref: Refinement }
	| { tag: "Match"; term: Term; alternatives: Alternative[] }
	| { tag: "Neutral"; term: Term }
	| { tag: "Exists"; variable: string; sort: Term; term: Term };

export type Literal =
	| { tag: "Int"; value: number }
	| { tag: "Bool"; value: boolean }
	| { tag: "String"; value: string }
	| { tag: "Unit" }
	| { tag: "Type" }
	| { tag: "Kind" };

export type Variable =
	| { tag: "Bound"; deBruijn: number }
	| { tag: "Free"; name: string };

export type Binder =
	| { tag: "Lambda"; variable: string; ann: Term }
	| { tag: "Pi"; variable: string; ann: Term }
	| { tag: "Let"; variable: string; val: Term; ann: Term };

export type Alternative = { tag: "Alt"; pattern: Pattern; term: Term };

export type Pattern =
	| { tag: "Lit"; value: Literal }
	| { tag: "Var"; variable: string };

export type Refinement =
	| { tag: "Hole" }
	| { tag: "Predicate"; variable: string; predicate: Term }
	| { tag: "Template"; hornVar: string; variable: string; range: Variable[] };

export const eq: (a: Term, b: Term) => boolean = (a, b) =>
	match([evaluate(a), evaluate(b)])
		.with(
			[{ tag: "Lit" }, { tag: "Lit" }],
			([{ value: a }, { value: b }]) => a === b,
		)
		.with(
			[{ tag: "Var" }, { tag: "Var" }],
			([{ variable: a }, { variable: b }]) => _.isEqual(a, b),
		)
		.with(
			[
				{ tag: "Abs", binder: { tag: "Let" } },
				{ tag: "Abs", binder: { tag: "Let" } },
			],
			([a, b]) =>
				eq(a.binder.val, b.binder.val) &&
				eq(a.binder.ann, b.binder.ann) &&
				eq(a.body, b.body),
		)
		.with(
			[{ tag: "Abs" }, { tag: "Abs" }],
			([a, b]) =>
				a.binder.tag === b.binder.tag &&
				eq(a.binder.ann, b.binder.ann) &&
				eq(a.body, b.body),
		)
		.with(
			[{ tag: "App" }, { tag: "App" }],
			([a, b]) => eq(a.func, b.func) && eq(a.arg, b.arg),
		)

		.otherwise(([a, b]) => _.isEqual(a, b));

// CONSTRUCTORS

export type Kind = "Pattern" | "Type";
export type Wrap<T, PT extends Kind> = PT extends "Pattern" ? P.Pattern<T> : T;

export const Lit = <K extends Kind = "Type">(
	value: Wrap<Literal, K>,
): Wrap<Term, K> => ({ tag: "Lit", value }) as Wrap<Term, K>;

export const Var = <K extends Kind = "Type">(
	variable: Wrap<Variable, K>,
): Wrap<Term, K> => ({ tag: "Var", variable }) as Wrap<Term, K>;
export const Abs = <K extends Kind = "Type">(
	binder: Wrap<Binder, K>,
	body: Wrap<Term, K>,
): Wrap<Term, K> => ({ tag: "Abs", binder, body }) as Wrap<Term, K>;
export const App = <K extends Kind = "Type">(
	func: Wrap<Term, K>,
	arg: Wrap<Term, K>,
): Wrap<Term, K> => ({ tag: "App", func, arg }) as Wrap<Term, K>;
export const Ann = <K extends Kind = "Type">(
	term: Wrap<Term, K>,
	ann: Wrap<Term, K>,
): Wrap<Term, K> => ({ tag: "Ann", term, ann }) as Wrap<Term, K>;
export const Refined = <K extends Kind = "Type">(
	term: Wrap<Term, K>,
	ref: Wrap<Refinement, K>,
): Wrap<Term, K> => ({ tag: "Refined", term, ref }) as Wrap<Term, K>;
export const Match = <K extends Kind = "Type">(
	term: Wrap<Term, K>,
	alternatives: Wrap<Alternative[], K>,
): Wrap<Term, K> => ({ tag: "Match", term, alternatives }) as Wrap<Term, K>;
export const Neutral = <K extends Kind = "Type">(
	term: Wrap<Term, K>,
): Wrap<Term, K> => ({ tag: "Neutral", term }) as Wrap<Term, K>;

export const Exists = <K extends Kind = "Type">(
	variable: Wrap<string, K>,
	sort: Wrap<Term, K>,
	term: Wrap<Term, K>,
): Wrap<Term, K> => ({ tag: "Exists", variable, sort, term }) as Wrap<Term, K>;

export const Int = <K extends Kind = "Type">(
	value: Wrap<number, K>,
): Wrap<Literal, K> => ({ tag: "Int", value }) as Wrap<Literal, K>;
export const Bool = <K extends Kind = "Type">(
	value: Wrap<boolean, K>,
): Wrap<Literal, K> => ({ tag: "Bool", value }) as Wrap<Literal, K>;
export const String = <K extends Kind = "Type">(
	value: Wrap<string, K>,
): Wrap<Literal, K> => ({ tag: "String", value }) as Wrap<Literal, K>;
export const Unit = <K extends Kind = "Type">(): Wrap<Literal, K> =>
	({ tag: "Unit" }) as Wrap<Literal, K>;
export const Type = <K extends Kind = "Type">(): Wrap<Literal, K> =>
	({ tag: "Type" }) as Wrap<Literal, K>;
export const Kind = <K extends Kind = "Type">(): Wrap<Literal, K> =>
	({ tag: "Kind" }) as Wrap<Literal, K>;

export const Lambda = <K extends Kind = "Type">(
	varName: Wrap<string, K>,
	ann: Wrap<Term, K>,
): Wrap<Binder, K> =>
	({ tag: "Lambda", variable: varName, ann }) as Wrap<Binder, K>;
export const Pi = <K extends Kind = "Type">(
	varName: Wrap<string, K>,
	ann: Wrap<Term, K>,
): Wrap<Binder, K> =>
	({ tag: "Pi", variable: varName, ann }) as Wrap<Binder, K>;
export const Let = <K extends Kind = "Type">(
	varName: Wrap<string, K>,
	val: Wrap<Term, K>,
	ann: Wrap<Term, K>,
): Wrap<Binder, K> =>
	({ tag: "Let", variable: varName, val, ann }) as Wrap<Binder, K>;

export const Alt = <K extends Kind = "Type">(
	pattern: Wrap<Pattern, K>,
	term: Wrap<Term, K>,
): Wrap<Alternative, K> =>
	({ tag: "Alt", pattern, term }) as Wrap<Alternative, K>;

export const Bound = (deBruijn: number): Variable => ({
	tag: "Bound",
	deBruijn,
});
export const Free = (name: string): Variable => ({ tag: "Free", name });

export const LitPattern = (value: Literal): Pattern => ({ tag: "Lit", value });
export const VarPattern = (variable: string): Pattern => ({
	tag: "Var",
	variable,
});

export const Hole = (): Refinement => ({ tag: "Hole" });
export const Predicate = (varName: string, predicate: Term): Refinement => ({
	tag: "Predicate",
	variable: varName,
	predicate,
});
export const Template = (
	hornVar: string,
	varName: string,
	range: Variable[],
): Refinement => ({ tag: "Template", hornVar, variable: varName, range });

// Binary operations
export type Op =
	| "+"
	| "-"
	| "*"
	| "/"
	| "<"
	| ">"
	| "<="
	| ">="
	| "=="
	| "!="
	| "||"
	| "&&";
export const Bop: (op: Op, a: Term, b: Term) => Term = (op, a, b) =>
	App(App(Var(Free(op)), a), b);

export const BopPattern = (op: Op) =>
	({
		tag: "App",
		func: {
			tag: "App",
			func: {
				tag: "Var",
				variable: { tag: "Free", name: op },
			},
		},
	}) as const;
