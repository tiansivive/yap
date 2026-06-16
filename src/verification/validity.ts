import { match } from "ts-pattern";

import { Build } from "./solver/ivl/build";
import { Patterns } from "./solver/ivl/patterns";
import type { IVL } from "./solver/ivl/types";
import { Solver, type Model } from "./solver/v2/solver";

export type Validity = { tag: "valid" } | { tag: "invalid"; model: Model } | { tag: "unknown"; reason: string };

export const Validity = {
	check: (formula: IVL.Formula): Validity => prove([], formula),

	display: (validity: Validity): string =>
		match(validity)
			.with({ tag: "valid" }, () => "valid")
			.with({ tag: "invalid" }, () => "invalid")
			.with({ tag: "unknown" }, ({ reason }) => `unknown: ${reason}`)
			.exhaustive(),
};

const prove = (assumptions: readonly IVL.Formula[], formula: IVL.Formula): Validity =>
	match(formula)
		.with(Patterns.Formula.And, ({ values }) => combine(values.map(f => prove(assumptions, f))))
		.with(Patterns.Formula.Forall, ({ body }) => proveGuarded(assumptions, body))
		.otherwise(goal => discharge(assumptions, goal));

const proveGuarded = (assumptions: readonly IVL.Formula[], formula: IVL.Formula): Validity =>
	match(formula)
		.with(Patterns.Formula.Implies, ({ left, right }) => proveGuarded([...assumptions, left], right))
		.with(Patterns.Formula.And, ({ values }) => proveGuarded(andGuards(assumptions, values), values[values.length - 1] ?? Build.true_()))
		.otherwise(goal => prove(assumptions, goal));

const andGuards = (assumptions: readonly IVL.Formula[], values: readonly IVL.Formula[]): readonly IVL.Formula[] => [...assumptions, ...values.slice(0, -1)];

const combine = (results: readonly Validity[]): Validity =>
	match(results.find(r => r.tag === "invalid"))
		.with({ tag: "invalid" }, r => r)
		.otherwise(() =>
			match(results.find(r => r.tag === "unknown"))
				.with({ tag: "unknown" }, r => r)
				.otherwise(() => ({ tag: "valid" })),
		);

const discharge = (assumptions: readonly IVL.Formula[], goal: IVL.Formula): Validity =>
	match(Solver.check(Build.and(...assumptions, Build.not(goal))))
		.with({ tag: "unsat" }, () => ({ tag: "valid" }) satisfies Validity)
		.with({ tag: "sat" }, ({ model }) => ({ tag: "invalid", model }) satisfies Validity)
		.with({ tag: "unknown" }, ({ reason }) => ({ tag: "unknown", reason }) satisfies Validity)
		.exhaustive();
