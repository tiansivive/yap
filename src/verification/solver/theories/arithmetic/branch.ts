// Branch-and-bound: checks integer feasibility after simplex finds a rational solution.
// Emits branching clauses (x <= floor(v) OR x >= ceil(v)) for fractional integer variables.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md
// B&B = Branch and Bound

import * as O from "fp-ts/Option";
import * as A from "fp-ts/Array";
import { pipe } from "fp-ts/function";
import type { Clause } from "../../cdcl/core";
import type { Tableau } from "./simplex";
import { Simplex } from "./simplex";
import { Rational } from "./rational";

export type BranchLemma = {
	readonly variable: string;
	readonly floor: Rational;
	readonly ceil: Rational;
};

export const Branch = {
	check: (tab: Tableau, integerVars: ReadonlySet<string>): O.Option<BranchLemma> =>
		pipe(
			[...integerVars],
			A.findFirstMap(v => {
				const value = Simplex.value(tab, v);
				return Rational.isInteger(value)
					? O.none
					: O.some({
							variable: v,
							floor: Rational.floor(value),
							ceil: Rational.ceil(value),
						});
			}),
		),
};
