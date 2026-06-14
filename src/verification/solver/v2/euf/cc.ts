/* eslint-disable @typescript-eslint/no-namespace */
// Congruence closure for v2 EUF: maintains equality classes over interned terms.
// CC = Congruence Closure; EUF = Equality with Uninterpreted Functions.
// https://github.com/tiansivive/z-yap/blob/main/zettels/congruence-closure.md

import * as E from "fp-ts/Either";
import type { Either } from "fp-ts/lib/Either";
import { match, P } from "ts-pattern";
import { type Clause, type Conflict, type Literal, Literal as Lit } from "../cdcl/model";
import type { Arena, Enode } from "./intern";

const THEORY_CLAUSE_ID = -1;

export const CC = {
	empty: {
		uf: new Map(),
		parents: new Map(),
		mergeLog: [],
		literalMap: new Map(),
		pending: [],
		stack: [],
	} satisfies CC.State,

	init: (arena: Arena.State): CC.State => ({
		...CC.empty,
		uf: new Map([...arena.nodes.keys()].map(id => [id, { parent: id, rank: 0 }])),
		parents: Parents.from(arena),
	}),

	register: (state: CC.State, literal: Literal, equality: Equality): CC.State => ({
		...state,
		literalMap: new Map([...state.literalMap, [literal, equality]]),
	}),

	assert: (state: CC.State, arena: Arena.State, literal: Literal): CC.Check =>
		match(state.literalMap.get(literal))
			.with(undefined, () => E.right({ state, propagations: [] }))
			.otherwise(equality =>
				match(equality.positive)
					.with(true, () => merge(state, arena, equality.a, equality.b, literal))
					.with(false, () =>
						match(equivalent(state, equality.a, equality.b))
							.with(true, () => E.left({ clause: ConflictClause.from(literal, CC.explain(state, equality.a, equality.b)) }))
							.with(false, () => E.right({ state, propagations: [] }))
							.exhaustive(),
					)
					.exhaustive(),
			),

	check: (state: CC.State): CC.Check =>
		match(Disequality.find(state))
			.with(undefined, () => E.right({ state: { ...state, pending: [] }, propagations: state.pending }))
			.otherwise(({ literal, equality }) => E.left({ clause: ConflictClause.from(literal, CC.explain(state, equality.a, equality.b)) })),

	push: (state: CC.State): CC.State => ({
		...state,
		stack: [...state.stack, { uf: state.uf, mergeLog: state.mergeLog }],
	}),

	pop: (state: CC.State): CC.State =>
		match(state.stack[state.stack.length - 1])
			.with(P.nullish, () => state)
			.otherwise(snapshot => ({
				...state,
				uf: snapshot.uf,
				mergeLog: snapshot.mergeLog,
				stack: state.stack.slice(0, -1),
			})),

	find: (state: CC.State, id: Enode.Id): Enode.Id =>
		match(state.uf.get(id))
			.with(undefined, () => id)
			.otherwise(entry =>
				match(entry.parent === id)
					.with(true, () => id)
					.with(false, () => CC.find(state, entry.parent))
					.exhaustive(),
			),

	explain: (state: CC.State, a: Enode.Id, b: Enode.Id): readonly Literal[] =>
		match(equivalent(state, a, b))
			.with(false, () => [])
			.with(true, () => Unique.literals(state.mergeLog.filter(reason => MergeScope.touches(state, reason, a, b)).map(reason => reason.reason)))
			.exhaustive(),
};

export namespace CC {
	export type Snapshot = {
		readonly uf: Map<Enode.Id, UF.Entry>;
		readonly mergeLog: readonly Merge.Reason[];
	};

	export type State = {
		readonly uf: Map<Enode.Id, UF.Entry>;
		readonly parents: Map<Enode.Id, Set<Enode.Id>>;
		readonly mergeLog: readonly Merge.Reason[];
		readonly literalMap: Map<Literal, Equality>;
		readonly pending: readonly Propagation[];
		readonly stack: readonly Snapshot[];
	};

	export type Update = {
		readonly state: State;
		readonly propagations: readonly Propagation[];
	};

	export type Check = Either<Conflict, Update>;
}

export namespace UF {
	export type Entry = {
		readonly parent: Enode.Id;
		readonly rank: number;
	};
}

export type Equality = {
	readonly a: Enode.Id;
	readonly b: Enode.Id;
	readonly positive: boolean;
};

export namespace Merge {
	export type Reason = {
		readonly a: Enode.Id;
		readonly b: Enode.Id;
		readonly reason: Literal;
	};
}

export type Propagation = {
	readonly literals: readonly Literal[];
	readonly justification: readonly Literal[];
};

export namespace Event {
	export type T =
		| { tag: "merge"; a: Enode.Id; b: Enode.Id; reason: Literal; winner: Enode.Id; loser: Enode.Id }
		| { tag: "skip"; root: Enode.Id }
		| { tag: "congruence"; left: Enode.Id; right: Enode.Id }
		| { tag: "conflict"; clause: Clause.T }
		| { tag: "scan"; literal: Literal; equal: boolean };
}

export type Event = Event.T;

const merge = (state: CC.State, arena: Arena.State, a: Enode.Id, b: Enode.Id, reason: Literal): CC.Check => {
	const rootA = CC.find(state, a);
	const rootB = CC.find(state, b);

	return match(rootA === rootB)
		.with(true, () => E.right({ state, propagations: [] }))
		.with(false, () => {
			const entryA = Entry.from(rootA, state.uf.get(rootA));
			const entryB = Entry.from(rootB, state.uf.get(rootB));
			const choice = Entry.choose(rootA, entryA, rootB, entryB);
			const next = {
				...state,
				uf: Entry.link(state.uf, choice.winner, choice.loser, entryA.rank === entryB.rank),
				parents: Parents.merge(state.parents, choice.winner, choice.loser),
				mergeLog: [...state.mergeLog, { a, b, reason }],
			};

			return Parents.pairs(state.parents, choice.winner, choice.loser).reduce<CC.Check>(
				(acc, pair) =>
					E.Monad.chain(acc, right =>
						match(Congruence.needs(right.state, arena, pair.left, pair.right))
							.with(true, () => merge(right.state, arena, pair.left, pair.right, reason))
							.with(false, () => E.right(right))
							.exhaustive(),
					),
				E.right({ state: next, propagations: [] }),
			);
		})
		.exhaustive();
};

const equivalent = (state: CC.State, a: Enode.Id, b: Enode.Id): boolean => CC.find(state, a) === CC.find(state, b);

const Entry = {
	from: (id: Enode.Id, entry: UF.Entry | undefined): UF.Entry => entry ?? { parent: id, rank: 0 },

	choose: (rootA: Enode.Id, entryA: UF.Entry, rootB: Enode.Id, entryB: UF.Entry): { winner: Enode.Id; loser: Enode.Id } =>
		entryA.rank >= entryB.rank ? { winner: rootA, loser: rootB } : { winner: rootB, loser: rootA },

	link: (uf: Map<Enode.Id, UF.Entry>, winner: Enode.Id, loser: Enode.Id, bump: boolean): Map<Enode.Id, UF.Entry> => {
		const loserRank = Entry.from(loser, uf.get(loser)).rank;
		const winnerRank = Entry.from(winner, uf.get(winner)).rank;
		return new Map([...uf, [loser, { parent: winner, rank: loserRank }], [winner, { parent: winner, rank: bump ? winnerRank + 1 : winnerRank }]]);
	},
};

const Parents = {
	from: (arena: Arena.State): Map<Enode.Id, Set<Enode.Id>> =>
		[...arena.nodes.values()].reduce<Map<Enode.Id, Set<Enode.Id>>>(
			(acc, node) => node.args.reduce<Map<Enode.Id, Set<Enode.Id>>>((inner, arg) => Parents.add(inner, arg, node.id), acc),
			new Map([...arena.nodes.keys()].map(id => [id, new Set<Enode.Id>()])),
		),

	add: (parents: Map<Enode.Id, Set<Enode.Id>>, child: Enode.Id, parent: Enode.Id): Map<Enode.Id, Set<Enode.Id>> =>
		new Map([...parents, [child, new Set([...(parents.get(child) ?? new Set()), parent])]]),

	merge: (parents: Map<Enode.Id, Set<Enode.Id>>, winner: Enode.Id, loser: Enode.Id): Map<Enode.Id, Set<Enode.Id>> =>
		new Map([...parents, [winner, new Set([...(parents.get(winner) ?? new Set()), ...(parents.get(loser) ?? new Set())])]]),

	pairs: (parents: Map<Enode.Id, Set<Enode.Id>>, winner: Enode.Id, loser: Enode.Id): { left: Enode.Id; right: Enode.Id }[] =>
		[...(parents.get(winner) ?? new Set())].flatMap(left => [...(parents.get(loser) ?? new Set())].map(right => ({ left, right }))),
};

const Congruence = {
	needs: (state: CC.State, arena: Arena.State, a: Enode.Id, b: Enode.Id): boolean => !equivalent(state, a, b) && Congruence.same(state, arena, a, b),

	same: (state: CC.State, arena: Arena.State, a: Enode.Id, b: Enode.Id): boolean =>
		match({ left: arena.nodes.get(a), right: arena.nodes.get(b) })
			.with(
				{ left: P.nonNullable, right: P.nonNullable },
				({ left, right }) =>
					left.head === right.head &&
					left.args.length === right.args.length &&
					left.args.every((arg, index) => CC.find(state, arg) === CC.find(state, right.args[index])),
			)
			.otherwise(() => false),
};

const Disequality = {
	find: (state: CC.State): { literal: Literal; equality: Equality } | undefined =>
		[...state.literalMap.entries()]
			.map(([literal, equality]) => ({ literal, equality }))
			.find(({ equality }) => !equality.positive && equivalent(state, equality.a, equality.b)),
};

const ConflictClause = {
	from: (literal: Literal, justification: readonly Literal[]): Clause.T => ({
		id: THEORY_CLAUSE_ID,
		literals: [...justification.map(Lit.negate), Lit.negate(literal)],
		origin: "euf:disequality-conflict",
	}),
};

const MergeScope = {
	touches: (state: CC.State, reason: Merge.Reason, a: Enode.Id, b: Enode.Id): boolean =>
		(equivalent(state, reason.a, a) && equivalent(state, reason.b, b)) || (equivalent(state, reason.a, b) && equivalent(state, reason.b, a)),
};

const Unique = {
	literals: (literals: readonly Literal[]): Literal[] => [...new Set(literals)],
};
