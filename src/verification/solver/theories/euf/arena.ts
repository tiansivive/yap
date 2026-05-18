// Hash-consed term arena: interns terms into unique integer identifiers (EnodeIds)
// to enable O(1) equality checks and efficient congruence closure.
// https://github.com/tiansivive/z-yap/blob/main/zettels/euf-theory.md
// EUF = Equality with Uninterpreted Functions, Enode = Equality node (term in the arena)

import type { IVL } from "../../ivl/types";

export type EnodeId = number;

export type Enode = {
	readonly id: EnodeId;
	readonly head: string;
	readonly args: readonly EnodeId[];
	readonly sort: IVL.Sort;
};

export type ArenaState = {
	readonly nodes: ReadonlyMap<EnodeId, Enode>;
	readonly hashIndex: ReadonlyMap<string, EnodeId>;
	readonly nextId: number;
};

// Justification for let: The arena accumulates interned terms over the solver's
// lifetime. Each intern call must check the hash index and conditionally add a new
// node. This is an append-only data structure that grows monotonically — expressing
// it as pure recursion would require threading the arena state through every caller.
// Internal mutability with a pure lookup API is standard for hash-consing.

export const Arena = {
	create: (): ArenaState => ({
		nodes: new Map(),
		hashIndex: new Map(),
		nextId: 0,
	}),

	intern: (state: ArenaState, head: string, args: readonly EnodeId[], sort: IVL.Sort): { id: EnodeId; state: ArenaState } => {
		const key = hashKey(head, args);
		const existing = state.hashIndex.get(key);

		if (existing !== undefined) {
			return { id: existing, state };
		}

		const id = state.nextId;
		const node: Enode = { id, head, args, sort };

		return {
			id,
			state: {
				nodes: new Map([...state.nodes, [id, node]]),
				hashIndex: new Map([...state.hashIndex, [key, id]]),
				nextId: id + 1,
			},
		};
	},

	lookup: (state: ArenaState, id: EnodeId): Enode | undefined => state.nodes.get(id),

	find: (state: ArenaState, head: string, args: readonly EnodeId[]): EnodeId | undefined => state.hashIndex.get(hashKey(head, args)),
};

const hashKey = (head: string, args: readonly EnodeId[]): string => (args.length === 0 ? head : `${head}(${args.join(",")})`);
