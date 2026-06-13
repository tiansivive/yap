// MBQI rounds instantiate quantified formulas over a bounded candidate universe and produce CDCL lemmas.
// MBQI = Model-Based Quantifier Instantiation; CDCL = Conflict-Driven Clause Learning.
// https://github.com/tiansivive/z-yap/blob/main/zettels/mbqi.md
// https://github.com/tiansivive/z-yap/blob/main/zettels/ge-de-moura-quantifiers.md

import { match } from "ts-pattern";
import type { Literal } from "../../cdcl";
import * as Core from "../../core";
import * as Encoding from "../../encoding";
import * as Trace from "../../trace";
import type { Info, Lemma, Simplification } from "../model";
import * as Candidates from "./candidates";
import type { Candidate } from "./grounding";
import * as Grounding from "./grounding";
import * as Universe from "./universe";

export const round = function* (): Core.G<Result> {
	const state = yield* Core.State.get();
	const universe = Universe.from(state.arena, state.quantifiers.quantifiers);
	const result = state.quantifiers.quantifiers.reduce<Accumulator>(
		(acc, info) => Candidates.enumerate(info.binders, universe).reduce((subAcc, candidate) => grounded(info, candidate, subAcc, state), acc),
		{ lemmas: [], newKeys: new Set(), instantiations: [] },
	);
	const next = yield* match(result.lemmas)
		.with([], () => Core.lift(result))
		.otherwise(function* (lemmas): Core.G<Result> {
			yield* Core.State.modify(s => ({
				...s,
				quantifiers: {
					...s.quantifiers,
					instantiated: new Set([...s.quantifiers.instantiated, ...result.newKeys]),
					generation: s.quantifiers.generation + 1,
					phase: { round: s.quantifiers.phase.round + 1, pending: lemmas },
				},
			}));
			return result;
		});
	yield* Trace.emit({ tag: "mbqi", round: state.quantifiers.phase.round, lemmas: next.lemmas, instantiations: next.instantiations });
	return next;
};

export type Result = {
	lemmas: Lemma[];
	newKeys: Set<string>;
	instantiations: Instantiation[];
};

export type Instantiation = {
	substitution: Map<string, string>;
	simplification: Simplification;
};

type Accumulator = Result;

const grounded = (info: Info, candidate: Candidate, acc: Accumulator, state: Core.State): Accumulator => {
	const id = `mbqi:${info.origin ?? "q"}[${Candidates.key(info.binders, candidate)}]`;
	return match(state.quantifiers.instantiated.has(id) || acc.newKeys.has(id))
		.with(true, () => acc)
		.with(false, () => process(Grounding.ground(info.body, candidate), id, info, candidate, acc, state))
		.exhaustive();
};

const process = (simplification: Simplification, id: string, info: Info, candidate: Candidate, acc: Accumulator, state: Core.State): Accumulator => {
	const tracked = {
		newKeys: new Set([...acc.newKeys, id]),
		instantiations: [...acc.instantiations, { substitution: Candidates.strings(candidate), simplification }],
	};
	return match(simplification)
		.with({ tag: "tautology" }, () => ({ ...acc, ...tracked }))
		.with({ tag: "contradiction" }, () => ({ lemmas: [...acc.lemmas, lemma(info, state.quantifiers.generation, [])], ...tracked }))
		.with({ tag: "residual" }, ({ formula }) =>
			match(Encoding.Lookup.literals(state.encoding, formula))
				.with([], () => ({ ...acc, ...tracked }))
				.otherwise(literals => ({ lemmas: [...acc.lemmas, lemma(info, state.quantifiers.generation, literals)], ...tracked })),
		)
		.exhaustive();
};

const lemma = (info: Info, generation: number, literals: readonly Literal[]): Lemma => ({
	clause: {
		literals: [...literals],
		origin: `mbqi:${info.origin ?? "forall"}:gen${generation}`,
	},
	origin: info.origin ?? "forall",
	generation,
	source: { tag: "mbqi" },
});
