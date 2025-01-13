import { match } from "ts-pattern";

import { Term, Variable as V } from "../../terms.js";
import { Context } from "./context.js";

import * as T from "./translation.js";
import { rv, sortOf, sub, symbolic } from "./helpers.js";

export type Constraint =
	| { tag: "Predicate"; pred: Predicate }
	| { tag: "And"; left: Constraint; right: Constraint }
	| {
			tag: "Forall";
			quantifier: string;
			sort: string;
			head: Predicate;
			body: Constraint;
	  };

export type Predicate =
	| { tag: "Symbol"; name: string }
	| { tag: "Variable"; name: string }
	| { tag: "Boolean"; value: boolean }
	| { tag: "Number"; value: number }
	| { tag: "String"; value: string }
	| { tag: "And"; left: Predicate; right: Predicate }
	| { tag: "Or"; left: Predicate; right: Predicate }
	| { tag: "Negation"; pred: Predicate }
	| { tag: "Iff"; a: Predicate; b: Predicate }
	| { tag: "BinArith"; a: Predicate; op: ArithOp; b: Predicate }
	| { tag: "BinLogic"; a: Predicate; op: LogicOp; b: Predicate }
	| { tag: "App"; func: Predicate; arg: Predicate }
	| { tag: "UninterpFunction"; func: string; arg: Predicate };

export type ArithOp = "+" | "-" | "*" | "/";
export type LogicOp = "<" | ">" | "<=" | ">=" | "==" | "!=";
export type Op = "+" | "-" | "*" | "/" | "<" | ">" | "<=" | ">=" | "==" | "!=";

// Constraint constructors
export const Predicate = (pred: Predicate): Constraint => ({
	tag: "Predicate",
	pred,
});
export const And = (left: Constraint, right: Constraint): Constraint => ({
	tag: "And",
	left,
	right,
});
export const Forall = (
	quantifier: string,
	sort: string,
	head: Predicate,
	body: Constraint,
): Constraint => ({ tag: "Forall", quantifier, sort, head, body });

// Predicate constructors
export const Symbol = (name: string): Predicate => ({ tag: "Symbol", name });
export const Variable = (name: string): Predicate => ({
	tag: "Variable",
	name,
});
export const Boolean = (value: boolean): Predicate => ({
	tag: "Boolean",
	value,
});
export const Number = (value: number): Predicate => ({ tag: "Number", value });
export const String = (value: string): Predicate => ({ tag: "String", value });

export const PAnd = (left: Predicate, right: Predicate): Predicate => ({
	tag: "And",
	left,
	right,
});
export const POr = (left: Predicate, right: Predicate): Predicate => ({
	tag: "Or",
	left,
	right,
});
export const Negation = (pred: Predicate): Predicate => ({
	tag: "Negation",
	pred,
});
export const Iff = (a: Predicate, b: Predicate): Predicate => ({
	tag: "Iff",
	a,
	b,
});

export const BinArith = (
	a: Predicate,
	op: ArithOp,
	b: Predicate,
): Predicate => ({ tag: "BinArith", a, op, b });
export const BinLogic = (
	a: Predicate,
	op: LogicOp,
	b: Predicate,
): Predicate => ({ tag: "BinLogic", a, op, b });

export const App = (func: Predicate, arg: Predicate): Predicate => ({
	tag: "App",
	func,
	arg,
});

export const UninterpFunction = (func: string, arg: Predicate): Predicate => ({
	tag: "UninterpFunction",
	func,
	arg,
});
