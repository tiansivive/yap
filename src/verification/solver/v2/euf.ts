/* eslint-disable @typescript-eslint/no-namespace */
// EUF v2 domain model: hash-consed terms and congruence-closure state.
// EUF = Equality with Uninterpreted Functions; CC = Congruence Closure; enodes are arena terms.
// https://github.com/tiansivive/z-yap/blob/main/zettels/euf-theory.md

import { match, P } from "ts-pattern";
import type { IVL } from "../ivl/types";
import type { Clause, Literal } from "./cdcl";

export namespace Enode {
	export type Id = number;

	export type T = {
		id: Id;
		head: string;
		args: Id[];
		sort: IVL.Sort;
	};
}

export namespace Arena {
	export type State = {
		nodes: Map<Enode.Id, Enode.T>;
		hashIndex: Map<string, Enode.Id>;
		nextId: number;
	};

	export type Interned = {
		id: Enode.Id;
		state: State;
	};

	export const empty: State = {
		nodes: new Map(),
		hashIndex: new Map(),
		nextId: 0,
	};

	export const intern = (state: State, head: string, args: Enode.Id[], sort: IVL.Sort): Interned =>
		match(state.hashIndex.get(key(head, args)))
			.with(P.number, id => ({ id, state }))
			.with(undefined, () => {
				const id = state.nextId;
				const node: Enode.T = { id, head, args, sort };
				return {
					id,
					state: {
						nodes: new Map([...state.nodes, [id, node]]),
						hashIndex: new Map([...state.hashIndex, [key(head, args), id]]),
						nextId: id + 1,
					},
				};
			})
			.exhaustive();

	export const lookup = (state: State, id: Enode.Id): Enode.T | undefined => state.nodes.get(id);

	export const find = (state: State, head: string, args: Enode.Id[]): Enode.Id | undefined => state.hashIndex.get(key(head, args));
}

export namespace UF {
	export type Entry = {
		parent: Enode.Id;
		rank: number;
	};
}

export type Equality = {
	a: Enode.Id;
	b: Enode.Id;
	positive: boolean;
};

export namespace Merge {
	export type Reason = {
		a: Enode.Id;
		b: Enode.Id;
		reason: Literal;
	};
}

export type Propagation = {
	literals: Literal[];
	justification: Literal[];
};

export namespace CC {
	export type Snapshot = {
		uf: Map<Enode.Id, UF.Entry>;
		mergeLog: Merge.Reason[];
	};

	export type State = {
		uf: Map<Enode.Id, UF.Entry>;
		parents: Map<Enode.Id, Set<Enode.Id>>;
		mergeLog: Merge.Reason[];
		literalMap: Map<Literal, Equality>;
		pending: Propagation[];
		stack: Snapshot[];
	};

	export const empty: State = {
		uf: new Map(),
		parents: new Map(),
		mergeLog: [],
		literalMap: new Map(),
		pending: [],
		stack: [],
	};

	export const init = (arena: Arena.State): State => ({
		...empty,
		uf: new Map([...arena.nodes.keys()].map(id => [id, { parent: id, rank: 0 }])),
		parents: parents(arena),
	});

	export const register = (state: State, literal: Literal, equality: Equality): State => ({
		...state,
		literalMap: new Map([...state.literalMap, [literal, equality]]),
	});

	export const push = (state: State): State => ({
		...state,
		stack: [...state.stack, { uf: new Map(state.uf), mergeLog: state.mergeLog }],
	});

	export const pop = (state: State): State =>
		match(state.stack[state.stack.length - 1])
			.with(P.nullish, () => state)
			.otherwise(snapshot => ({
				...state,
				uf: snapshot.uf,
				mergeLog: snapshot.mergeLog,
				stack: state.stack.slice(0, -1),
			}));
}

export namespace Event {
	export type T =
		| { tag: "merge"; a: Enode.Id; b: Enode.Id; reason: Literal; winner: Enode.Id; loser: Enode.Id }
		| { tag: "skip"; root: Enode.Id }
		| { tag: "congruence"; left: Enode.Id; right: Enode.Id }
		| { tag: "conflict"; clause: Clause.T }
		| { tag: "scan"; literal: Literal; equal: boolean };
}

export type Event = Event.T;

const parents = (arena: Arena.State): Map<Enode.Id, Set<Enode.Id>> => {
	const empty: Map<Enode.Id, Set<Enode.Id>> = new Map([...arena.nodes.keys()].map(id => [id, new Set<Enode.Id>()] as const));
	return [...arena.nodes.values()].reduce<Map<Enode.Id, Set<Enode.Id>>>(
		(acc, node) =>
			node.args.reduce<Map<Enode.Id, Set<Enode.Id>>>((inner, arg) => new Map([...inner, [arg, new Set([...(inner.get(arg) ?? new Set()), node.id])]]), acc),
		empty,
	);
};

const key = (head: string, args: Enode.Id[]): string =>
	match(args)
		.with([], () => head)
		.otherwise(values => `${head}(${values.join(",")})`);
