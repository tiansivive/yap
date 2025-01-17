import { Implicitness, Literal, Multiplicity } from "../shared";

import Shared from "../shared";

import { Extend } from "../../utils/types";

import * as NF from "./normalized";

export type ModalTerm = Extend<Term, Term, Multiplicity>;
export type Node = Extend<Term, Term, NF.ModalValue>;

export type Term =
	| { type: "Lit"; value: Literal }
	| { type: "Var"; variable: Variable }
	| { type: "Abs"; binding: Binding; body: Term }
	| { type: "App"; icit: Implicitness; func: Term; arg: Term }
	| { type: "Annotation"; term: Term; ann: Term };

export type Variable =
	| { type: "Bound"; index: number }
	| { type: "Free"; name: string }
	| { type: "Meta"; index: number };

export type Binding =
	| { type: "Let"; variable: string; value: Term; annotation: Term }
	| { type: "Pi"; variable: string; annotation: Term; icit: Implicitness }
	| { type: "Lambda"; variable: string; icit: Implicitness };

type Spine = Array<"Bound" | "Defined">;

export const Lit = (value: Literal) => ({ type: "Lit", value }) as const;
export const Var = (variable: Variable) => ({ type: "Var", variable }) as const;

export const Abs = (binding: Binding, body: Term) =>
	({ type: "Abs", binding, body }) as const;
export const App = (icit: Implicitness, func: Term, arg: Term): Term => ({
	type: "App",
	icit,
	func,
	arg,
});

export const Bound = (index: number): Variable => ({ type: "Bound", index });
export const Free = (name: string): Variable => ({ type: "Free", name });
export const Meta = (index: number): Variable => ({ type: "Meta", index });

export const Let = (
	variable: string,
	value: Term,
	annotation: Term,
): Binding => ({ type: "Let", variable, value, annotation });
export const Pi = (
	variable: string,
	annotation: Term,
	icit: Implicitness,
): Binding => ({ type: "Pi", variable, annotation, icit });

export const LitM = (
	value: Literal,
	multiplicity: Multiplicity = Shared.Many,
): ModalTerm => [{ type: "Lit", value }, multiplicity];
export const VarM = (
	variable: Variable,
	multiplicity: Multiplicity = Shared.Many,
): ModalTerm => [{ type: "Var", variable }, multiplicity];

// export const AbsM = (binding: Binding, body: Term, multiplicity: Multiplicity= Shared.Many): ModalTerm => [{ type: "Abs", binding, body }, multiplicity]
// export const AppM = (icit: Implicitness, func: Term, arg: Term, multiplicity: Multiplicity= Shared.Many): ModalTerm => [{ type: "App", icit, func, arg }, multiplicity]

// export const AnnotationM = (term: Term, ann: ModalTerm, multiplicity: Multiplicity = Shared.Many): ModalTerm => ({ type: "Quantity", multiplicity, value: Annotation(term, ann) })
