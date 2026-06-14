// Split skolemized IVL into propositional and quantified fragments.
// IVL = Intermediate Verification Language.
// https://github.com/tiansivive/z-yap/blob/main/zettels/quantifier-engine.md

import { match } from "ts-pattern";
import { Build } from "../../ivl/build";
import type { IVL } from "../../ivl/types";

export const separate = (formula: IVL.Formula): Result =>
	match(formula)
		.with({ tag: "And" }, ({ values, origin }) => {
			const grouped = values.reduce<Result>(
				(acc, value) =>
					match(value)
						.with({ tag: "Forall" }, q => ({ ...acc, quantifiers: [...acc.quantifiers, q] }))
						.otherwise(p => ({ ...acc, propositional: append(acc.propositional, p, origin) })),
				{ propositional: Build.true_(), quantifiers: [] },
			);
			return { ...grouped, propositional: normalizeAnd(grouped.propositional, origin) };
		})
		.with({ tag: "Forall" }, f => ({ propositional: Build.true_(), quantifiers: [f] }))
		.otherwise(f => ({ propositional: f, quantifiers: [] }));

export type Result = {
	propositional: IVL.Formula;
	quantifiers: IVL.Formula[];
};

const append = (current: IVL.Formula, next: IVL.Formula, origin?: string): IVL.Formula =>
	match(current)
		.with({ tag: "True" }, () => Build.andWithOrigin([next], origin))
		.with({ tag: "And" }, ({ values }) => Build.andWithOrigin([...values, next], origin))
		.otherwise(f => Build.andWithOrigin([f, next], origin));

const normalizeAnd = (formula: IVL.Formula, origin?: string): IVL.Formula =>
	match(formula)
		.with({ tag: "And" }, ({ values }) => Build.andWithOrigin(values, origin))
		.otherwise(f => f);
