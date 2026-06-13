// Quantifier rounds orchestrate E-matching first, then MBQI as the fallback instantiation strategy.
// MBQI = Model-Based Quantifier Instantiation.
// https://github.com/tiansivive/z-yap/blob/main/zettels/ge-de-moura-quantifiers.md

import { match } from "ts-pattern";
import type { Clause } from "../cdcl";
import * as Core from "../core";
import * as EMatch from "./ematch";
import * as MBQI from "./mbqi";
import type { Lemma } from "./model";

export const step = function* (): Core.G<Step> {
	const ematch = yield* EMatch.round();
	const first = decide(ematch.lemmas);
	return yield* match(first)
		.with({ tag: "lemmas" }, function* (step): Core.G<Step> {
			return step;
		})
		.with({ tag: "saturated" }, function* (): Core.G<Step> {
			const mbqi = yield* MBQI.round();
			return decide(mbqi.lemmas);
		})
		.exhaustive();
};

export type Step = { tag: "saturated" } | { tag: "lemmas"; clauses: Clause.T[] };

const decide = (lemmas: Lemma[]): Step =>
	match(lemmas)
		.with([], () => ({ tag: "saturated" }) satisfies Step)
		.otherwise(
			lemmas =>
				({
					tag: "lemmas",
					clauses: lemmas.map(lemma => lemma.clause),
				}) satisfies Step,
		);
