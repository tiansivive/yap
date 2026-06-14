/* eslint-disable @typescript-eslint/no-namespace */
// Shared quantifier model: extracted quantifiers, state, generated lemmas, and trace events.
// CDCL = Conflict-Driven Clause Learning; MBQI = Model-Based Quantifier Instantiation.

import type { IVL } from "../../ivl/types";
import type { Clause } from "../cdcl";

export type State = {
	quantifiers: Info[];
	generation: number;
	instantiated: Set<string>;
	phase: Phase;
};

export const State = {
	empty: {
		quantifiers: [],
		generation: 0,
		instantiated: new Set(),
		phase: { round: 0, pending: [] },
	} satisfies State,

	from: (quantifiers: Info[]): State => ({
		...State.empty,
		quantifiers,
	}),
};

export type Phase = {
	round: number;
	pending: Lemma[];
};

export type Info = {
	binders: IVL.Binder[];
	body: IVL.Formula;
	triggers: Trigger[];
	origin?: string;
};

export type Trigger = {
	terms: IVL.Term[];
	boundVars: string[];
};

export type Lemma = {
	clause: Clause.T;
	origin: string;
	generation: number;
	source: Source;
};

export type Source = { tag: "ematch" } | { tag: "mbqi" };

export type Simplification = { tag: "tautology" } | { tag: "contradiction" } | { tag: "residual"; formula: IVL.Formula };

export type Sample = {
	substitution: Map<string, string>;
	simplification: Simplification;
};

export namespace Event {
	export type T =
		| { tag: "round"; round: number; lemmas: number }
		| { tag: "mbqi"; round: number; instantiations: Sample[] }
		| { tag: "pure"; quantifiers: number };
}
