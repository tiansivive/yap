import { Extend } from "../../utils/types";

import * as Q from "@qtt/shared/modalities/multiplicity";
import * as NF from "./normalization";
import * as R from "@qtt/shared/rows";
import * as Lit from "@qtt/shared/literals";
import { Implicitness } from "@qtt/shared/implicitness";
import { Literal } from "@qtt/shared/literals";

import { Pattern as Pat } from "ts-pattern";

export type ModalTerm = Extend<Term, Term, Q.Multiplicity>;
export type Node = Extend<Term, Term, NF.ModalValue>;

export type Term =
	| { type: "Lit"; value: Literal }
	| { type: "Var"; variable: Variable }
	| { type: "Abs"; binding: Binding; body: Term }
	| { type: "App"; icit: Implicitness; func: Term; arg: Term }
	| { type: "Row"; row: Row }
	| { type: "Proj"; label: string; term: Term }
	| { type: "Inj"; label: string; value: Term; term: Term }
	| { type: "Annotation"; term: Term; ann: Term }
	| { type: "Match"; scrutinee: Term; alternatives: Array<Alternative> };

export type Variable = { type: "Bound"; index: number } | { type: "Free"; name: string } | { type: "Meta"; index: number };
export type Row = R.Row<Term, Variable>;

export type Binding =
	| { type: "Let"; variable: string; value: Term; annotation: Term }
	| { type: "Lambda"; variable: string; icit: Implicitness }
	| { type: "Mu"; variable: string; annotation: Term }
	| {
			type: "Pi";
			variable: string;
			annotation: Term;
			multiplicity: Q.Multiplicity;
			icit: Implicitness;
	  };

export type Alternative = { pattern: Pattern; term: Term };
export type Pattern =
	| { type: "Binder"; value: string }
	| { type: "Var"; value: string; term: Term }
	| { type: "Lit"; value: Literal }
	| { type: "Row"; row: R.Row<Pattern, string> }
	| { type: "Struct"; row: R.Row<Pattern, string> };

type Spine = Array<"Bound" | "Defined">;

export type Statement = { type: "Expression"; value: Term } | { type: "Let"; variable: string; value: Term; annotation: Term };

export const Bound = (index: number): Variable => ({ type: "Bound", index });
export const Free = (name: string): Variable => ({ type: "Free", name });
export const Meta = (index: number): Variable => ({ type: "Meta", index });

export const Constructors = {
	Abs: (binding: Binding, body: Term): Term => ({ type: "Abs", binding, body }),
	Lambda: (variable: string, icit: Implicitness, body: Term): Term => ({
		type: "Abs",
		binding: { type: "Lambda" as const, variable, icit },
		body,
	}),
	Pi: (variable: string, icit: Implicitness, multiplicity: Q.Multiplicity, annotation: Term, body: Term): Term => ({
		type: "Abs",
		binding: { type: "Pi" as const, variable, icit, annotation, multiplicity },
		body,
	}),
	Mu: (variable: string, annotation: Term, body: Term): Term => ({
		type: "Abs",
		binding: { type: "Mu" as const, variable, annotation },
		body,
	}),
	Var: (variable: Variable): Term => ({
		type: "Var",
		variable,
	}),

	App: (icit: Implicitness, func: Term, arg: Term): Term => ({
		type: "App",
		icit,
		func,
		arg,
	}),
	Lit: (value: Literal): Term => ({
		type: "Lit",
		value,
	}),

	Annotation: (term: Term, ann: Term): Term => ({ type: "Annotation", term, ann }),

	Row: (row: Row): Term => ({ type: "Row", row }),
	Extension: (label: string, value: Term, row: Row): Row => ({ type: "extension", label, value, row }),

	Struct: (row: Row): Term => Constructors.App("Explicit", Constructors.Lit(Lit.Atom("Struct")), Constructors.Row(row)),
	Schema: (row: Row): Term => Constructors.App("Explicit", Constructors.Lit(Lit.Atom("Schema")), Constructors.Row(row)),
	Variant: (row: Row): Term => Constructors.App("Explicit", Constructors.Lit(Lit.Atom("Variant")), Constructors.Row(row)),
	Proj: (label: string, term: Term): Term => ({ type: "Proj", label, term }),
	Inj: (label: string, value: Term, term: Term): Term => ({ type: "Inj", label, value, term }),

	Match: (scrutinee: Term, alternatives: Array<Alternative>): Term => ({ type: "Match", scrutinee, alternatives }),
	Alternative: (pattern: Pattern, term: Term): Alternative => ({ pattern, term }),
	Patterns: {
		Binder: (value: string): Pattern => ({ type: "Binder", value }),
		Var: (value: string, term: Term): Pattern => ({ type: "Var", value, term }),
		Lit: (value: Literal): Pattern => ({ type: "Lit", value }),
		Row: (row: R.Row<Pattern, string>): Pattern => ({ type: "Row", row }),
		Extension: (label: string, value: Pattern, row: R.Row<Pattern, string>): R.Row<Pattern, string> => R.Constructors.Extension(label, value, row),
		Struct: (row: R.Row<Pattern, string>): Pattern => ({ type: "Struct", row }),
	},
	Stmt: {
		Let: (variable: string, value: Term, annotation: Term): Statement => ({ type: "Let", variable, value, annotation }),
		Expr: (value: Term): Statement => ({ type: "Expression", value }),
	},
};

export const PatternMatch: Record<string, Pat.Pattern<Term>> = {
	Var: { type: "Var" },
	Lit: { type: "Lit" },
	Lambda: { type: "Abs", binding: { type: "Lambda" } },
	Pi: { type: "Abs", binding: { type: "Pi" } },
	Mu: { type: "Abs", binding: { type: "Mu" } },
	Match: { type: "Match" },
	Row: { type: "Row" },
	Proj: { type: "Proj" },
	Inj: { type: "Inj" },
	Annotation: { type: "Annotation" },
};
