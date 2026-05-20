// Theory interface: the shared boundary between the CDCL boolean core and
// theory-specific reasoning modules (EUF, arithmetic, etc.).
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import * as E from "fp-ts/Either";
import type { Clause, Literal, Conflict } from "../cdcl/core";
import type { Rational } from "./arithmetic/rational";
import type { EnodeId } from "./euf/arena";

export type TheoryPropagation = {
	readonly literals: readonly Literal[];
	readonly justification: readonly Literal[];
};

export type TheoryCheck = E.Either<Conflict, readonly TheoryPropagation[]>;

export namespace EUFTrace {
	export type Step =
		| { readonly tag: "merge"; readonly a: EnodeId; readonly b: EnodeId; readonly reason: Literal; readonly winner: EnodeId; readonly loser: EnodeId }
		| { readonly tag: "merge-skip"; readonly root: EnodeId }
		| { readonly tag: "congruence"; readonly pA: EnodeId; readonly pB: EnodeId }
		| { readonly tag: "conflict"; readonly clause: Clause }
		| { readonly tag: "scan"; readonly literal: Literal; readonly equal: boolean };
}

export namespace ArithTrace {
	export type Step =
		| { readonly tag: "bound"; readonly variable: string; readonly kind: "lower" | "upper"; readonly value: Rational; readonly strict: boolean }
		| { readonly tag: "bound-conflict"; readonly variable: string; readonly lower: Rational; readonly upper: Rational }
		| { readonly tag: "violation"; readonly variable: string; readonly value: Rational; readonly direction: "below" | "above" }
		| { readonly tag: "pivot"; readonly leaving: string; readonly entering: string }
		| { readonly tag: "infeasible"; readonly variable: string }
		| { readonly tag: "feasible" };
}

export type TheoryStep = EUFTrace.Step | ArithTrace.Step;

export type TracedTheoryCheck = Generator<TheoryStep, TheoryCheck>;

export type Theory = {
	readonly name: string;
	readonly assert: (literal: Literal) => TheoryCheck;
	readonly check: () => TheoryCheck;
	readonly assertTrace: (literal: Literal) => TracedTheoryCheck;
	readonly checkTrace: () => TracedTheoryCheck;
	readonly push: () => void;
	readonly pop: () => void;
	readonly explain: (literal: Literal) => readonly Literal[];
};
