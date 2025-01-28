import { Extend } from "../../utils/types";

import * as Q from "@qtt/shared/modalities/multiplicity";
import * as NF from "./normalization";
import * as R from "@qtt/shared/rows";
import * as Lit from "@qtt/shared/literals";
import { Implicitness } from "@qtt/shared/implicitness";
import { Literal } from "@qtt/shared/literals";

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
	| { type: "Annotation"; term: Term; ann: Term };

export type Variable = { type: "Bound"; index: number } | { type: "Free"; name: string } | { type: "Meta"; index: number };

export type Binding =
	| { type: "Let"; variable: string; value: Term; annotation: Term }
	| { type: "Lambda"; variable: string; icit: Implicitness }
	| {
			type: "Pi";
			variable: string;
			annotation: Term;
			multiplicity: Q.Multiplicity;
			icit: Implicitness;
	  };

export type Row = R.Row<Term, Variable>;
type Spine = Array<"Bound" | "Defined">;

export const Bound = (index: number): Variable => ({ type: "Bound", index });
export const Free = (name: string): Variable => ({ type: "Free", name });
export const Meta = (index: number): Variable => ({ type: "Meta", index });

export const Constructors = {
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
	Variant: (row: Row): Term => Constructors.App("Explicit", Constructors.Lit(Lit.Atom("Variant")), Constructors.Row(row)),
	Proj: (label: string, term: Term): Term => ({ type: "Proj", label, term }),
	Inj: (label: string, value: Term, term: Term): Term => ({ type: "Inj", label, value, term }),
};

type Foo = { [k: number]: number };

const foo: Foo = [1, 2, 3];
