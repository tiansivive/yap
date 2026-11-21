// Grounding substitutes MBQI candidates into quantified bodies and classifies the simplified result.
// MBQI = Model-Based Quantifier Instantiation.
// https://github.com/tiansivive/z-yap/blob/main/zettels/mbqi.md

import { match } from "ts-pattern";
import { interpret } from "../../../ivl/interpret";
import { Patterns } from "../../../ivl/patterns";
import type { IVL } from "../../../ivl/types";
import type { Simplification } from "../model";

export const ground = (formula: IVL.Formula, candidate: Candidate): Simplification => simplify(interpret(formula, candidate));

export type Candidate = ReadonlyMap<string, IVL.Term>;

const simplify = (formula: IVL.Formula): Simplification =>
	match(formula)
		.with(Patterns.Formula.True, () => ({ tag: "tautology" }) satisfies Simplification)
		.with(Patterns.Formula.False, () => ({ tag: "contradiction" }) satisfies Simplification)
		.otherwise(f => ({ tag: "residual", formula: f }) satisfies Simplification);
