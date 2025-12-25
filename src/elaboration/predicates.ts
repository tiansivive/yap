import * as Src from "@yap/src/index";
import * as NF from "./normalization";

// Type guard: Src.Term is a lambda term
export function isLambda(term: Src.Term): term is Extract<Src.Term, { type: "lambda" }> {
	return term.type === "lambda";
}

// Helper type describing an abstraction whose binder is an implicit Pi
export type ImplicitPiAbs = NF.Value & {
	type: "Abs";
	binder: Extract<NF.Binder, { type: "Pi" }> & { icit: "Implicit" };
};

// Type guard: NF.Value is an implicit pi abstraction (Abs over Pi with icit Implicit)
export function isImplicitPiAbs(val: NF.Value): val is ImplicitPiAbs {
	return val.type === "Abs" && val.binder.type === "Pi" && val.binder.icit === "Implicit";
}
