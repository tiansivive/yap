import { Implicitness, Literal, Multiplicity } from "../shared";

export type Term =
	| { type: "lit"; value: Literal }
	| { type: "var"; variable: Variable }
	| { type: "arrow"; lhs: Term; rhs: Term; icit: Implicitness }
	| {
			type: "lambda";
			icit: Implicitness;
			variable: string;
			multiplicity?: Multiplicity;
			annotation?: Term;
			body: Term;
	  }
	| {
			type: "pi";
			icit: Implicitness;
			variable: string;
			multiplicity?: Multiplicity;
			annotation: Term;
			body: Term;
	  }
	| { type: "application"; fn: Term; arg: Term; icit: Implicitness }
	| { type: "annotation"; term: Term; ann: Term; multiplicity?: Multiplicity }
	| { type: "hole" }
	| { type: "block"; statements: Statement[]; return?: Term }
	| { type: "list"; elements: Term[] }
	| { type: "tuple"; row: Row }
	| { type: "struct"; row: Row }
	| { type: "variant"; row: Row }
	| { type: "row"; row: Row }
	| { type: "injection"; label: string; value: Term; term: Term }
	| { type: "projection"; label: string; term: Term };

export type Row = { type: "empty" } | { type: "extension"; label: string; value: Term; row: Row } | { type: "variable"; variable: Variable };

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

export const Row = (row: Row): Term => ({ type: "row", row });
export const Struct = (row: Row): Term => ({ type: "struct", row });
export const Variant = (row: Row): Term => ({ type: "variant", row });
export const List = (elements: Term[]): Term => ({ type: "list", elements });
export const Tuple = (row: Term[]): Term => ({
	type: "tuple",
	row: row.reduceRight<Row>(
		(r, el, i) => {
			return {
				type: "extension",
				label: i.toString(),
				value: el,
				row: r,
			};
		},
		{ type: "empty" },
	),
});

export const Injection = (label: string, value: Term, term: Term): Term => ({ type: "injection", label, value, term });
export const Projection = (label: string, term: Term): Term => ({ type: "projection", label, term });

export const Annotation = (term: Term, ann: Term, multiplicity?: Multiplicity): Term => ({
	type: "annotation",
	term,
	ann,
	multiplicity,
});

export const Block = (statements: Statement[], ret?: Term): Term => {
	return {
		type: "block",
		statements,
		return: ret,
	};
};
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

//
const a = (obj: Record<string, any>) => ({ ...obj, a: 1 });
// { obj | a: 1 }
// { a: 1 | obj }

// [...arr]
// [ |arr]
// [ 1, 2, 3, |arr]

// fn (a, b, |rest]) => a + b + c
