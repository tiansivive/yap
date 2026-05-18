// Two-watched-literal scheme: efficient unit propagation by watching exactly two
// literals per clause. Only inspects clauses when a watched literal becomes false.
// https://github.com/tiansivive/z-yap/blob/main/zettels/watched-literals.md
// BCP = Boolean Constraint Propagation

import * as E from "fp-ts/Either";
import { Literal } from "./core";
import type { Clause, Conflict, Variable, Assignment } from "./core";

const { variable, polarity } = Literal;

export type WatchEntry = {
	readonly clauseId: number;
	readonly otherWatch: Literal;
};

export type WatchList = ReadonlyMap<Literal, readonly WatchEntry[]>;

export type PropagateResult = E.Either<Conflict, readonly Literal[]>;

export const Watched = {
	create: (clauses: readonly Clause[]): WatchList => {
		const watches = new Map<Literal, WatchEntry[]>();

		const addWatch = (lit: Literal, entry: WatchEntry): void => {
			const existing = watches.get(lit) ?? [];
			watches.set(lit, [...existing, entry]);
		};

		clauses.forEach(clause => {
			if (clause.literals.length < 2) {
				return;
			}
			addWatch(clause.literals[0], { clauseId: clause.id, otherWatch: clause.literals[1] });
			addWatch(clause.literals[1], { clauseId: clause.id, otherWatch: clause.literals[0] });
		});

		return watches;
	},

	propagate: (
		falsifiedLiteral: Literal,
		watches: WatchList,
		clauses: ReadonlyMap<number, Clause>,
		assignments: ReadonlyMap<Variable, Assignment>,
	): { result: PropagateResult; watches: WatchList; propagations: readonly { literal: Literal; reason: Clause }[] } => {
		const watchedBy = watches.get(falsifiedLiteral) ?? [];
		const mutableWatches = new Map(watches);
		const remaining: WatchEntry[] = [];
		const propagations: { literal: Literal; reason: Clause }[] = [];

		for (const entry of watchedBy) {
			const clause = clauses.get(entry.clauseId);

			if (!clause) {
				continue;
			}

			const otherSatisfied = isLiteralTrue(assignments, entry.otherWatch);
			if (otherSatisfied) {
				remaining.push(entry);
				continue;
			}

			const replacement = clause.literals.find(lit => lit !== falsifiedLiteral && lit !== entry.otherWatch && !isLiteralFalse(assignments, lit));

			if (replacement !== undefined) {
				const newEntry: WatchEntry = { clauseId: clause.id, otherWatch: entry.otherWatch };
				const replacementWatches = mutableWatches.get(replacement) ?? [];
				mutableWatches.set(replacement, [...replacementWatches, newEntry]);
				continue;
			}

			remaining.push(entry);

			if (isLiteralFalse(assignments, entry.otherWatch)) {
				mutableWatches.set(falsifiedLiteral, [...remaining, ...watchedBy.slice(watchedBy.indexOf(entry) + 1)]);
				return { result: E.left({ clause }), watches: mutableWatches, propagations };
			}

			if (!isLiteralTrue(assignments, entry.otherWatch) && !isLiteralFalse(assignments, entry.otherWatch)) {
				propagations.push({ literal: entry.otherWatch, reason: clause });
			}
		}

		mutableWatches.set(falsifiedLiteral, remaining);
		return { result: E.right(propagations.map(p => p.literal)), watches: mutableWatches, propagations };
	},
};

const isLiteralTrue = (assignments: ReadonlyMap<Variable, Assignment>, lit: Literal): boolean => {
	const asgn = assignments.get(variable(lit));
	return (polarity(lit) && asgn === "true") || (!polarity(lit) && asgn === "false");
};

const isLiteralFalse = (assignments: ReadonlyMap<Variable, Assignment>, lit: Literal): boolean => {
	const asgn = assignments.get(variable(lit));
	return (polarity(lit) && asgn === "false") || (!polarity(lit) && asgn === "true");
};
