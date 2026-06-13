// Formula encoding exports for the v2 solver.
// https://github.com/tiansivive/z-yap/blob/main/zettels/tseitin-cnf.md

import type { IVL } from "../../ivl/types";
import type * as Enc from "./model";
import * as CNF from "./cnf";
import * as Lookup from "./lookup";

export const run = (propositional: IVL.Formula, lemmas: IVL.Formula[] = []): Result => ({
	encoding: CNF.encode(propositional),
	lemmas,
});

export type Result = {
	encoding: Enc.State;
	lemmas: IVL.Formula[];
};

export * from "./model";
export { CNF, Lookup };
