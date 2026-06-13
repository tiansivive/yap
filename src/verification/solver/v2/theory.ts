/* eslint-disable @typescript-eslint/no-namespace */
// Theory v2 domain model: concrete cooperating theories over shared solver state.
// The first v2 scaffold keeps the bundle concrete; future row/string theories can widen it.
// https://github.com/tiansivive/z-yap/blob/main/zettels/theory-plugin-interface.md

import type { Either } from "fp-ts/lib/Either";
import * as Arithmetic from "./arithmetic";
import type { Conflict, Literal } from "./cdcl";
import * as Core from "./core";
import type { Propagation as EufPropagation } from "./euf";
import * as EUF from "./euf";

export type State = {
	euf: EUF.CC.State;
	arithmetic: Arithmetic.State;
};

export const State = {
	empty: {
		euf: EUF.CC.empty,
		arithmetic: Arithmetic.State.empty,
	} satisfies State,

	enter: (state: State): State => ({
		...state,
		euf: EUF.CC.push(state.euf),
		arithmetic: Arithmetic.State.push(state.arithmetic),
	}),

	backtrack: (state: State): State => ({
		...state,
		euf: EUF.CC.pop(state.euf),
		arithmetic: Arithmetic.State.pop(state.arithmetic),
	}),
};

export const Theories = {
	replace: (theories: State) => Core.State.modify(s => ({ ...s, theories })),

	enter: Core.State.modify(s => ({ ...s, theories: State.enter(s.theories) })),
	backtrack: Core.State.modify(s => ({ ...s, theories: State.backtrack(s.theories) })),
};

export const Propagation = {
	fromEuf: (p: EufPropagation): Propagation => ({
		literals: p.literals,
		justification: p.justification,
	}),
};

export type Propagation = {
	literals: Literal[];
	justification: Literal[];
};

export namespace Event {
	export type Local = { tag: "euf"; event: EUF.Event } | { tag: "arithmetic"; event: Arithmetic.Event };

	export type T =
		| { tag: "assert"; theory: string; literal: Literal; result: "ok" | "conflict"; detail: Local[] }
		| { tag: "check"; theory: string; result: "ok" | "conflict"; detail: Local[] }
		| { tag: "enter"; level: number }
		| { tag: "backtrack"; to: number };
}

export type Event = Event.T;

export type Check = Either<Conflict, Propagation[]>;
