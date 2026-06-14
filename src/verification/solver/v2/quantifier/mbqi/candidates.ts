// Candidate generation builds binder substitutions from the finite MBQI universe.
// MBQI = Model-Based Quantifier Instantiation.
// https://github.com/tiansivive/z-yap/blob/main/zettels/mbqi.md

import { match } from "ts-pattern";
import { Build } from "../../../ivl/build";
import type { IVL } from "../../../ivl/types";
import type { Candidate } from "./grounding";
import type { Universe } from "./universe";
import * as UniverseOps from "./universe";

export const enumerate = (binders: IVL.Binder[], universe: Universe): Candidate[] => {
	const domains = binders.map(b => ({ name: b.name, terms: universe.get(UniverseOps.sort(b.sort)) ?? [] }));
	return match(domains.some(d => d.terms.length === 0))
		.with(true, () => [])
		.with(false, () => cartesian(domains, new Map()))
		.exhaustive();
};

const cartesian = (domains: Domain[], current: Candidate): Candidate[] =>
	match(domains)
		.with([], () => [current])
		.otherwise(([domain, ...rest]) => domain.terms.flatMap(term => cartesian(rest, new Map([...current, [domain.name, term]]))));

type Domain = {
	name: string;
	terms: IVL.Term[];
};

export const strings = (candidate: Candidate): Map<string, string> => new Map([...candidate.entries()].map(([name, term]) => [name, UniverseOps.string(term)]));

export const key = (binders: IVL.Binder[], candidate: Candidate): string =>
	binders.map(b => `${b.name}=${UniverseOps.key(candidate.get(b.name) ?? Build.const_("?", Build.Unit))}`).join(",");
