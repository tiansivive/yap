import * as Eff from "@yap/utils/effects";

import * as P from "@yap/elaboration/shared/provenance";
import * as EB from "@yap/elaboration";
import type * as Metas from "@yap/elaboration/shared/metas";

import { Monoid } from "fp-ts/lib/Monoid";
import { Cause } from "./errors";

/* No callstack here: NbE owns its machine and installs it at its own public entries. */
export type Elaboration<A> = Eff.Eff<
	Eff.Actions<[typeof writer, typeof reader, typeof except, typeof st, typeof supply, typeof tracer, typeof Metas.registry]>,
	A
>;

type Collector = {
	constraints: P.WithProvenance<EB.Constraint>[];
};

const monoid: Monoid<Collector> = {
	empty: { constraints: [] },
	concat: (x, y) => ({
		constraints: [...x.constraints, ...y.constraints],
	}),
};

export const writer = Eff.writer(monoid);
export const reader = Eff.reader<EB.Context>();
export const except = Eff.except<Err>();
export type Err = Cause & { provenance?: P.Provenance[]; ctx: EB.Context };

export const tracer = Eff.tracer<P.Provenance>();

export const st = Eff.st<MutState>();

export const supply = Eff.supply<"meta" | "var" | "skolem">();

export const of = Eff.of;
export const traverse = Eff.traverse;

/* TODO(provenance): stamp `trace` from the tracer once the main migration lands. */
export const constrain = function* (constraints: EB.Constraint | EB.Constraint[]) {
	const many = Array.isArray(constraints) ? constraints : [constraints];

	yield* writer.tell({ constraints: many.map(c => ({ ...c, trace: [] })) });
};

/* TODO(provenance): attach the tracer's stack once the main migration lands. */
export const fail = function* (cause: Cause) {
	const ctx = yield* reader.ask();

	return yield* except.raise({ ...cause, ctx });
};

export type MutState = {
	delimitations: Array<Delimitation>;
	nondeterminism: {
		solution: Record<number, EB.NF.Value[]>;
	};
};

export type Delimitation = {
	answer: { initial: EB.NF.Value; final: EB.NF.Value };
	//handlerQ: Array<{ meta: EB.Meta, handler: Src.Term, ann: EB.NF.Value }>;
	//solution: Record<number, { values: EB.NF.Value[], term: EB.Term }>;

	/** `
	 * Needed to know if any shift has occurred within the reset.
	 * If `false`, we can enforce that the initial and final answer types are the same.
	 * Dumb but effective.
	 **/
	shifted: boolean;
};
