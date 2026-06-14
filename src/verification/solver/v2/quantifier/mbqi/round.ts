// MBQI rounds instantiate quantified formulas over a bounded candidate universe and produce CDCL lemmas.
// MBQI = Model-Based Quantifier Instantiation; CDCL = Conflict-Driven Clause Learning.
// https://github.com/tiansivive/z-yap/blob/main/zettels/mbqi.md
// https://github.com/tiansivive/z-yap/blob/main/zettels/ge-de-moura-quantifiers.md

import { match } from "ts-pattern";
import type { IVL } from "../../../ivl/types";
import type { Literal } from "../../cdcl";
import type { Arena } from "../../euf";
import type { Info, Lemma, Simplification } from "../model";
import * as Candidates from "./candidates";
import type { Candidate } from "./grounding";
import * as Grounding from "./grounding";
import * as Universe from "./universe";

export const round = (quantifiers: Info[], arena: Arena.State, instantiated: Set<string>, generation: number, next: Next, encode: Encode): Result => {
	const universe = Universe.from(arena, quantifiers);
	return quantifiers.reduce<Accumulator>(
		(acc, info) =>
			Candidates.enumerate(info.binders, universe).reduce(
				(subAcc, candidate) => grounded(info, candidate, subAcc, instantiated, generation, next, encode),
				acc,
			),
		{ lemmas: [], newKeys: new Set(), instantiations: [] },
	);
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

export type Next = () => number;

export type Encode = (formula: IVL.Formula) => Literal[];

type Accumulator = Result;

const grounded = (
	info: Info,
	candidate: Candidate,
	acc: Accumulator,
	instantiated: Set<string>,
	generation: number,
	next: Next,
	encode: Encode,
): Accumulator => {
	const id = `mbqi:${info.origin ?? "q"}[${Candidates.key(info.binders, candidate)}]`;
	return match(instantiated.has(id) || acc.newKeys.has(id))
		.with(true, () => acc)
		.with(false, () => process(Grounding.ground(info.body, candidate), id, info, candidate, acc, generation, next, encode))
		.exhaustive();
};

const process = (
	simplification: Simplification,
	id: string,
	info: Info,
	candidate: Candidate,
	acc: Accumulator,
	generation: number,
	next: Next,
	encode: Encode,
): Accumulator => {
	const tracked = {
		newKeys: new Set([...acc.newKeys, id]),
		instantiations: [...acc.instantiations, { substitution: Candidates.strings(candidate), simplification }],
	};
	return match(simplification)
		.with({ tag: "tautology" }, () => ({ ...acc, ...tracked }))
		.with({ tag: "contradiction" }, () => ({ lemmas: [...acc.lemmas, lemma(info, generation, next, [])], ...tracked }))
		.with({ tag: "residual" }, ({ formula }) =>
			match(encode(formula))
				.with([], () => ({ ...acc, ...tracked }))
				.otherwise(literals => ({ lemmas: [...acc.lemmas, lemma(info, generation, next, literals)], ...tracked })),
		)
		.exhaustive();
};

const lemma = (info: Info, generation: number, next: Next, literals: Literal[]): Lemma => ({
	clause: {
		id: next(),
		literals: [...literals],
		origin: `mbqi:${info.origin ?? "forall"}:gen${generation}`,
	},
	origin: info.origin ?? "forall",
	generation,
	source: { tag: "mbqi" },
});
