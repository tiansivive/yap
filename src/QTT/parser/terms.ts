import { Implicitness } from "@qtt/shared/implicitness";
import { Literal } from "@qtt/shared/literals";
import * as Q from "@qtt/shared/modalities/multiplicity";
import { WithLocation } from "@qtt/shared/provenance";
import * as R from "@qtt/shared/rows";

export type Term = WithLocation<Bare>;

export type Bare =
	| { type: "lit"; value: Literal }
	| { type: "var"; variable: Variable }
	| { type: "hole" }
	| { type: "arrow"; lhs: Term; rhs: Term; icit: Implicitness }
	| {
			type: "lambda";
			icit: Implicitness;
			variable: string;
			multiplicity?: Q.Multiplicity;
			annotation?: Term;
			body: Term;
	  }
	| {
			type: "pi";
			icit: Implicitness;
			variable: string;
			multiplicity?: Q.Multiplicity;
			annotation: Term;
			body: Term;
	  }
	| { type: "application"; fn: Term; arg: Term; icit: Implicitness }
	| { type: "annotation"; term: Term; ann: Term; multiplicity?: Q.Multiplicity }
	| { type: "list"; elements: Term[] }
	| { type: "tuple"; row: Row }
	| { type: "struct"; row: Row }
	| { type: "dict"; index: Term; term: Term }
	| { type: "tagged"; tag: string; term: Term }
	| { type: "variant"; row: Row }
	| { type: "row"; row: Row }
	| { type: "injection"; label: string; value: Term; term: Term }
	| { type: "projection"; label: string; term: Term }
	| { type: "match"; scrutinee: Term; alternatives: Array<Alternative> }
	| { type: "block"; statements: Statement[]; return?: Term };

export type Alternative = WithLocation<{ pattern: Pattern; term: Term }>;
export type Pattern =
	| { type: "var"; value: Variable }
	| { type: "lit"; value: Literal }
	| { type: "row"; row: R.Row<Pattern, Variable> }
	| { type: "struct"; row: R.Row<Pattern, Variable> }
	| { type: "variant"; row: R.Row<Pattern, Variable> }
	| { type: "tuple"; row: R.Row<Pattern, Variable> }
	| { type: "list"; elements: Pattern[]; rest?: Variable }
	| { type: "wildcard" };

export type Statement = WithLocation<BareStatement>;
type BareStatement =
	| { type: "expression"; value: Term }
	| {
			type: "let";
			variable: string;
			value: Term;
			annotation?: Term;
			multiplicity?: Q.Multiplicity;
	  }
	| { type: "using"; value: Term }
	| { type: "foreign"; variable: string; annotation: Term };

export type Variable = WithLocation<{ type: "name"; value: string } | { type: "label"; value: string }>;
export type Row = WithLocation<R.Row<Term, Variable>>;

export type Module = { type: "module"; imports: Import[]; exports: Export; content: Script };
export type Script = { type: "script"; script: Statement[] };

export type Import =
	| { type: "*"; filepath: string; hiding: string[] }
	| { type: "qualified"; filepath: string; as: string; hiding: string[] }
	| { type: "explicit"; filepath: string; names: string[] };

export type Export = { type: "*" } | { type: "explicit"; names: string[] } | { type: "partial"; hiding: string[] };
