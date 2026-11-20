// Formula transformation pipeline for the v2 solver.
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import type { IVL } from "../../ivl/types";
import { normalize } from "./normalize";
import { separate } from "./separate";
import { skolemize } from "./skolem";

export const run = (formula: IVL.Formula): Result => {
	const normalized = normalize(formula);
	const skolemized = skolemize(normalized);
	const separated = separate(skolemized);
	return { normalized, skolemized, ...separated };
};

export type Result = {
	normalized: IVL.Formula;
	skolemized: IVL.Formula;
	propositional: IVL.Formula;
	quantifiers: IVL.Formula[];
};

export { normalize, separate, skolemize };
