// Core Erlang AST

export type Expr =
	| { type: "Lit"; value: Lit }
	| { type: "Var"; name: string }
	| { type: "Let"; vars: string[]; value: Expr; body: Expr }
	| { type: "Letrec"; defs: FunDef[]; body: Expr }
	| { type: "Apply"; func: Expr; args: Expr[] }
	| { type: "Call"; module: string; func: string; args: Expr[] }
	| { type: "Case"; expr: Expr; clauses: Clause[] }
	| { type: "Tuple"; elements: Expr[] }
	| { type: "Cons"; head: Expr; tail: Expr }
	| { type: "Nil" }
	| { type: "Fun"; module: string; name: string; arity: number };

export type Lit = { type: "Int"; value: number } | { type: "Atom"; value: string } | { type: "String"; value: string };

export type Pattern = { type: "PLit"; value: Lit } | { type: "PVar"; name: string } | { type: "PTuple"; elements: Pattern[] } | { type: "PWild" };

export type Clause = {
	pattern: Pattern;
	guard: Expr;
	body: Expr;
};

export type FunDef = {
	name: string;
	arity: number;
	params: string[];
	body: Expr;
};

export type Module = {
	name: string;
	exports: Array<{ name: string; arity: number }>;
	defs: FunDef[];
};

// --- Lit constructors ---

export const Int = (value: number): Lit => ({ type: "Int", value });
export const Atom = (value: string): Lit => ({ type: "Atom", value });
export const Str = (value: string): Lit => ({ type: "String", value });

// --- Expr constructors ---

export const Lit = (value: Lit): Expr => ({ type: "Lit", value });
export const Var = (name: string): Expr => ({ type: "Var", name });
export const Let = (vars: string[], value: Expr, body: Expr): Expr => ({ type: "Let", vars, value, body });
export const Let1 = (name: string, value: Expr, body: Expr): Expr => Let([name], value, body);
export const Letrec = (defs: FunDef[], body: Expr): Expr => ({ type: "Letrec", defs, body });
export const Apply = (func: Expr, args: Expr[]): Expr => ({ type: "Apply", func, args });
export const Call = (mod: string, func: string, args: Expr[]): Expr => ({ type: "Call", module: mod, func, args });
export const Case = (expr: Expr, clauses: Clause[]): Expr => ({ type: "Case", expr, clauses });
export const Tuple = (elements: Expr[]): Expr => ({ type: "Tuple", elements });
export const Cons = (head: Expr, tail: Expr): Expr => ({ type: "Cons", head, tail });
export const Nil: Expr = { type: "Nil" };
export const Fun = (mod: string, name: string, arity: number): Expr => ({ type: "Fun", module: mod, name, arity });

// --- Pattern constructors ---

export const PLit = (value: Lit): Pattern => ({ type: "PLit", value });
export const PVar = (name: string): Pattern => ({ type: "PVar", name });
export const PTuple = (elements: Pattern[]): Pattern => ({ type: "PTuple", elements });
export const PWild: Pattern = { type: "PWild" };

// --- Clause ---

export const Clause = (pattern: Pattern, guard: Expr, body: Expr): Clause => ({ pattern, guard, body });

export const TrueGuard: Expr = Lit(Atom("true"));

// --- FunDef ---

export const FunDef = (name: string, params: string[], body: Expr): FunDef => ({ name, arity: params.length, params, body });

// --- Module ---

export const Module = (name: string, exports: Array<{ name: string; arity: number }>, defs: FunDef[]): Module => ({ name, exports, defs });

// --- Helpers ---

export const List = (elements: Expr[]): Expr => elements.reduceRight<Expr>((tail, head) => Cons(head, tail), Nil);
