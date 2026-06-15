/* eslint-disable @typescript-eslint/no-namespace */
// Solver v2 trace events: writer payloads for observable CDCL(T) execution.
// CDCL(T) = Conflict-Driven Clause Learning modulo theories.
// https://github.com/tiansivive/z-yap/blob/main/zettels/solver-trace.md

import * as E from "fp-ts/Either";
import type * as CDCL from "./cdcl";
import * as Core from "./core";
import type * as Quantifier from "./quantifier";
import type * as Theory from "./theory";

export const Trace = {
	emit: (step: Event.T) => Trace.emitMany([step]),

	emitMany: function* (steps: Event.T[]): Core.G<void> {
		yield (_env, _w, st = Core.State.initial) => [{ ...Core.Accumulator.empty, steps, result: E.right(undefined) }, st];
	},
};

export namespace Event {
	export type Result =
		| { tag: "sat"; assignments: Map<CDCL.Variable, CDCL.Assignment> }
		| { tag: "unsat"; core: CDCL.Clause.T[] }
		| { tag: "unknown"; reason: string };

	export type T = CDCL.Event | Theory.Event | Quantifier.Event.T | Result;
}

export type Diagnostic = {
	origin?: string;
	message: string;
};

export namespace Proof {
	export type Event = {
		origin: string;
		clause: CDCL.Clause.T;
	};
}

export type Stats = {
	decisions: number;
	propagations: number;
	conflicts: number;
	quantifierRounds: number;
};

export const Stats = {
	empty: {
		decisions: 0,
		propagations: 0,
		conflicts: 0,
		quantifierRounds: 0,
	} satisfies Stats,

	concat: (a: Stats, b: Stats): Stats => ({
		decisions: a.decisions + b.decisions,
		propagations: a.propagations + b.propagations,
		conflicts: a.conflicts + b.conflicts,
		quantifierRounds: a.quantifierRounds + b.quantifierRounds,
	}),
};

export * as Print from "./trace/print";
export * as Replay from "./trace/replay";
