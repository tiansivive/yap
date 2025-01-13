import {
	Let,
	Lit,
	Type,
	Var,
	Free,
	Refined,
	Predicate,
	Bool,
	Kind,
} from "./terms.js";

export const Types = {
	Int: Var(Free("Int")),
	Bool: Var(Free("Bool")),
	String: Var(Free("String")),
	Unit: Var(Free("Unit")),
	Type: Lit(Type()),
	Kind: Lit(Kind()),
};

export const Env = {
	Int: Let(
		"Int",
		Refined(Types.Int, Predicate("i", Lit(Bool(true)))),
		Lit(Type()),
	),
	Bool: Let(
		"Bool",
		Refined(Types.Bool, Predicate("b", Lit(Bool(true)))),
		Lit(Type()),
	),
	String: Let(
		"String",
		Refined(Types.String, Predicate("s", Lit(Bool(true)))),
		Lit(Type()),
	),
	Unit: Let(
		"Unit",
		Refined(Types.Unit, Predicate("u", Lit(Bool(true)))),
		Lit(Type()),
	),
};
