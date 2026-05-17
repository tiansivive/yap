import * as E from "fp-ts/Either";
import * as RA from "fp-ts/ReadonlyArray";
import { pipe } from "fp-ts/function";

import type { Tag, Label } from "../vocabulary";
import type { Pass } from "../grs/strategy";
import * as Strategy from "../grs/strategy";
import type { Descriptor, Vocabulary } from "./descriptor";
import { Initial } from "./descriptor";

export type Inconsistency =
	| { readonly type: "MissingTag"; readonly pass: string; readonly tag: Tag }
	| { readonly type: "MissingLabel"; readonly pass: string; readonly label: Label }
	| { readonly type: "ConsumedAfterRemoval"; readonly pass: string; readonly element: Tag | Label; readonly removedBy: string };

export type Pipeline = {
	readonly descriptors: ReadonlyArray<Descriptor>;
	readonly run: Pass;
	readonly finalVocabulary: Vocabulary;
};

export const configure = (...descriptors: Descriptor[]): E.Either<ReadonlyArray<Inconsistency>, Pipeline> => {
	const seed: Acc = {
		tags: Initial.tags,
		labels: Initial.labels,
		removals: new Map(),
		errors: [],
	};

	return pipe(
		descriptors,
		RA.reduce(seed, step),
		E.fromPredicate(
			({ errors }) => errors.length === 0,
			acc => acc.errors,
		),
		E.map(acc => ({
			descriptors,
			run: Strategy.seq(...descriptors.map(d => d.run)),
			finalVocabulary: { tags: acc.tags, labels: acc.labels },
		})),
	);
};

const step = (acc: Acc, d: Descriptor): Acc => {
	const reqErrors = checkRequirements(acc, d);
	const removalWarnings = checkConsumedAfterRemoval(acc, d);

	const tags = union(subtract(acc.tags, d.delta.tags.removed), d.delta.tags.added);
	const labels = union(subtract(acc.labels, d.delta.labels.removed), d.delta.labels.added);

	const removals = new Map(acc.removals);

	for (const t of d.delta.tags.removed) {
		removals.set(t, d.name);
	}

	for (const l of d.delta.labels.removed) {
		removals.set(l, d.name);
	}

	return { tags, labels, removals, errors: [...acc.errors, ...reqErrors, ...removalWarnings] };
};

type Acc = {
	readonly tags: ReadonlySet<Tag>;
	readonly labels: ReadonlySet<Label>;
	readonly removals: ReadonlyMap<Tag | Label, string>;
	readonly errors: ReadonlyArray<Inconsistency>;
};

const checkRequirements = (acc: Acc, d: Descriptor): ReadonlyArray<Inconsistency> => [
	...Array.from(d.requires.tags)
		.filter(t => !acc.tags.has(t))
		.map((tag): Inconsistency => ({ type: "MissingTag", pass: d.name, tag })),
	...Array.from(d.requires.labels)
		.filter(l => !acc.labels.has(l))
		.map((label): Inconsistency => ({ type: "MissingLabel", pass: d.name, label })),
];

const checkConsumedAfterRemoval = (acc: Acc, d: Descriptor): ReadonlyArray<Inconsistency> => {
	const required = [...d.requires.tags, ...d.requires.labels] as ReadonlyArray<Tag | Label>;
	return required
		.filter(el => acc.removals.has(el))
		.map(
			(element): Inconsistency => ({
				type: "ConsumedAfterRemoval",
				pass: d.name,
				element,
				removedBy: acc.removals.get(element)!,
			}),
		);
};

const subtract = <A>(base: ReadonlySet<A>, removed: ReadonlySet<A>): ReadonlySet<A> => new Set([...base].filter(x => !removed.has(x)));

const union = <A>(a: ReadonlySet<A>, b: ReadonlySet<A>): ReadonlySet<A> => new Set([...a, ...b]);
