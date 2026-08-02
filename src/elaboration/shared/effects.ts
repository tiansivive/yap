import * as Eff from "@yap/utils/effects";

import * as P from "@yap/elaboration/shared/provenance";
import * as EB from "@yap/elaboration";
import * as Metas from "@yap/elaboration/shared/metas";

import { Monoid } from "fp-ts/lib/Monoid";
import { Cause } from "./errors";

type Collector = {
	constraints: P.WithProvenance<EB.Constraint>[];
};

const monoid: Monoid<Collector> = {
	empty: { constraints: [] },
	concat: (x, y) => ({
		constraints: [...x.constraints, ...y.constraints],
	}),
};

export const writer = Eff.Writer(monoid);
export const reader = Eff.Reader<EB.Context>;
export const except = Eff.Except<Err>();
export type Err = Cause & { provenance?: P.Provenance[]; ctx: EB.Context };

export const st = Eff.ST<MutState>;

export type MutState = {
	delimitations: Array<Delimitation>;
	nondeterminism: {
		solution: Record<number, EB.NF.Value[]>;
	};
	registry: Metas.Registry;
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
