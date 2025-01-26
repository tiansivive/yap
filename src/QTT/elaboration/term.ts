import { Extend } from "../../utils/types";

import * as Q from "@qtt/shared/modalities/multiplicity";
import * as NF from "./normalization";
import { Literal } from "@qtt/shared/literals";
import { Implicitness } from "@qtt/shared/implicitness";

export type ModalTerm = Extend<Term, Term, Q.Multiplicity>;
export type Node = Extend<Term, Term, NF.ModalValue>;

export type Term =
	| { type: "Lit"; value: Literal }
	| { type: "Var"; variable: Variable }
	| { type: "Abs"; binding: Binding; body: Term }
	| { type: "App"; icit: Implicitness; func: Term; arg: Term }
	| { type: "Annotation"; term: Term; ann: Term };

export type Variable = { type: "Bound"; index: number } | { type: "Free"; name: string } | { type: "Meta"; index: number };

export type Binding =
	| { type: "Let"; variable: string; value: Term; annotation: Term }
	| {
			type: "Pi";
			variable: string;
			annotation: Term;
			multiplicity: Q.Multiplicity;
			icit: Implicitness;
	  }
	| { type: "Lambda"; variable: string; icit: Implicitness };

type Spine = Array<"Bound" | "Defined">;

export const Bound = (index: number): Variable => ({ type: "Bound", index });
export const Free = (name: string): Variable => ({ type: "Free", name });
export const Meta = (index: number): Variable => ({ type: "Meta", index });

export const Constructors = {
	Lambda: <T>(variable: string, icit: Implicitness, body: T) => ({
		type: "Abs" as const,
		binding: { type: "Lambda" as const, variable, icit },
		body,
	}),
	Pi: <T>(variable: string, icit: Implicitness, multiplicity: Q.Multiplicity, annotation: T, body: T) => ({
		type: "Abs" as const,
		binding: { type: "Pi" as const, variable, icit, annotation, multiplicity },
		body,
	}),
	Var: (variable: Variable) => ({
		type: "Var" as const,
		variable,
	}),

	App: <T>(icit: Implicitness, func: T, arg: T) => ({
		type: "App" as const,
		icit,
		func,
		arg,
	}),
	Lit: (value: Literal) => ({
		type: "Lit" as const,
		value,
	}),
};
