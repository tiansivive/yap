/* eslint-disable @typescript-eslint/no-namespace */
// Quantifier v2 domain model: instantiation state for E-matching and bounded MBQI.
// MBQI = Model-Based Quantifier Instantiation.
// https://github.com/tiansivive/z-yap/blob/main/zettels/quantifier-engine.md

import { set, update } from "@yap/utils";
import type { IVL } from "../ivl/types";
import type { Clause } from "./cdcl";
import * as Core from "./core";

export type Trigger = {
	terms: IVL.Term[];
};

export type Info = {
	binders: IVL.Binder[];
	body: IVL.Formula;
	triggers: Trigger[];
	origin?: string;
};

export type Lemma = {
	clause: Clause.T;
	origin: string;
	generation: number;
};

export type Substitution = Map<string, IVL.Term>;

export type Instantiation = {
	substitution: Map<string, string>;
	simplified: "true" | "false" | "formula";
};

export type Phase = {
	round: number;
	pending: Lemma[];
};

export type State = {
	quantifiers: Info[];
	generation: number;
	instantiated: Set<string>;
	phase: Phase;
};

export namespace Event {
	export type T =
		| { tag: "round"; round: number; lemmas: number }
		| { tag: "mbqi"; round: number; instantiations: Instantiation[] }
		| { tag: "pure"; quantifiers: number };
}

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

export const Generation = {
	advance: Core.State.modify(
		update("quantifiers", q => ({
			...q,
			generation: q.generation + 1,
			phase: { ...q.phase, round: q.phase.round + 1 },
		})),
	),
};

export const Instantiations = {
	remember: (keys: Set<string>) =>
		Core.State.modify(
			update("quantifiers", q => ({
				...q,
				instantiated: new Set([...q.instantiated, ...keys]),
			})),
		),
};

export const Lemmas = {
	clear: Core.State.modify(set("quantifiers.phase.pending", [])),
	stage: (pending: Lemma[]) => Core.State.modify(set("quantifiers.phase.pending", pending)),
};
