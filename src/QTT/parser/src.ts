import { Implicitness, Literal, Multiplicity } from "../shared";

export type Term =
	| { type: "lit"; value: Literal }
	| { type: "var"; variable: Variable }
	| {
			type: "pi";
			icit: Implicitness;
			variable: string;
			multiplicity?: Multiplicity;
			annotation: Term;
			body: Term;
	  }
	| { type: "arrow"; lhs: Term; rhs: Term; icit: Implicitness }
	| {
			type: "lambda";
			icit: Implicitness;
			variable: string;
			multiplicity?: Multiplicity;
			annotation?: Term;
			body: Term;
	  }
	| { type: "application"; fn: Term; arg: Term; icit: Implicitness }
	| { type: "annotation"; term: Term; ann: Term; multiplicity?: Multiplicity }
	| { type: "hole" }
	| { type: "block"; statements: Statement[]; return?: Term }
	| { type: "row"; row: Row };

export type Row = { type: "empty" } | { type: "extension"; label: string; value: Term; rest: Row } | { type: "variable"; variable: Variable };

export type Statement =
	| { type: "expression"; value: Term }
	| {
			type: "let";
			variable: string;
			value: Term;
			annotation?: Term;
			multiplicity?: Multiplicity;
	  };

export type Variable = { type: "name"; value: string };

export const num = (value: number) => Lit({ type: "Num", value });
export const bool = (value: boolean) => Lit({ type: "Bool", value });
export const str = (value: string) => Lit({ type: "String", value });

export const Lit = (value: Literal): Term => ({ type: "lit", value });
export const Var = (variable: Variable): Term => ({ type: "var", variable });

export const Arrow = (lhs: Term, rhs: Term, icit: Implicitness): Term => ({
	type: "arrow",
	lhs,
	rhs,
	icit,
});
export const Pi = (icit: Implicitness, variable: string, annotation: Term, body: Term, multiplicity?: Multiplicity): Term => ({
	type: "pi",
	icit,
	variable,
	annotation,
	body,
	multiplicity,
});
export const Lambda = (icit: Implicitness, variable: string, body: Term, annotation?: Term, multiplicity?: Multiplicity): Term => ({
	type: "lambda",
	icit,
	variable,
	annotation,
	body,
	multiplicity,
});

export const Application = (fn: Term, arg: Term, icit: Implicitness = "Explicit"): Term => ({ type: "application", fn, arg, icit });

export const Annotation = (term: Term, ann: Term, multiplicity?: Multiplicity): Term => ({
	type: "annotation",
	term,
	ann,
	multiplicity,
});

export const Row = (row: Row): Term => ({ type: "row", row });

export const Block = (statements: Statement[], ret?: Term): Term => ({
	type: "block",
	statements,
	return: ret,
});
export const Expression = (value: Term): Statement => ({
	type: "expression",
	value,
});
export const Let = (variable: string, value: Term, annotation?: Term, multiplicity?: Multiplicity): Statement => ({
	type: "let",
	variable,
	value,
	annotation,
	multiplicity,
});

export const Hole: Term = { type: "hole" };
