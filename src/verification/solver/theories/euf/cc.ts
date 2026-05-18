// Congruence closure: maintains equivalence classes over the term arena via union-find.
// When a = b is asserted, merges their classes and propagates congruences to parents.
// https://github.com/tiansivive/z-yap/blob/main/zettels/congruence-closure.md
// CC = Congruence Closure, EUF = Equality with Uninterpreted Functions

import * as E from "fp-ts/Either";
import { Literal } from "../../cdcl/core";
import type { Clause, Conflict } from "../../cdcl/core";
import type { Theory, TheoryCheck, TheoryPropagation } from "../theory";
import type { EnodeId, ArenaState } from "./arena";

const { negate } = Literal;

const THEORY_CLAUSE_ID = -1;

type UnionFindEntry = {
	readonly parent: EnodeId;
	readonly rank: number;
};

type MergeReason = {
	readonly a: EnodeId;
	readonly b: EnodeId;
	readonly reason: Literal;
};

export type CCState = {
	readonly uf: Map<EnodeId, UnionFindEntry>;
	readonly parents: Map<EnodeId, Set<EnodeId>>;
	readonly mergeLog: MergeReason[];
	readonly literalMap: Map<Literal, { a: EnodeId; b: EnodeId; positive: boolean }>;
	readonly pendingPropagations: TheoryPropagation[];
	readonly stateStack: { ufSnapshot: Map<EnodeId, UnionFindEntry>; mergeLogLength: number }[];
};

export const EUF = {
	create: (arena: ArenaState): { theory: Theory; state: CCState } => {
		const state = initState(arena);
		const theory = buildTheory(state, arena);
		return { theory, state };
	},

	register: (state: CCState, literal: Literal, a: EnodeId, b: EnodeId, positive: boolean): void => {
		state.literalMap.set(literal, { a, b, positive });
	},
};

const initState = (arena: ArenaState): CCState => {
	const uf = new Map<EnodeId, UnionFindEntry>();
	const parents = new Map<EnodeId, Set<EnodeId>>();

	arena.nodes.forEach((_, id) => {
		uf.set(id, { parent: id, rank: 0 });
		parents.set(id, new Set());
	});

	arena.nodes.forEach(node => {
		node.args.forEach(argId => {
			parents.get(argId)?.add(node.id);
		});
	});

	return {
		uf,
		parents,
		mergeLog: [],
		literalMap: new Map(),
		pendingPropagations: [],
		stateStack: [],
	};
};

// Justification for let: Union-find requires path compression (in-place parent updates)
// for amortized O(α(n)) find. Push/pop snapshots the UF for incremental backtracking.
// Future: generator-based effect system would isolate this behind a pure interface.

const buildTheory = (state: CCState, arena: ArenaState): Theory => ({
	name: "euf",
	assert: literal => assertLiteral(state, arena, literal),
	check: () => check(state),
	push: () => push(state),
	pop: () => pop(state),
	explain: literal => explainLiteral(state, literal),
});

const find = (uf: Map<EnodeId, UnionFindEntry>, id: EnodeId): EnodeId => {
	const entry = uf.get(id);

	if (!entry || entry.parent === id) {
		return id;
	}
	const root = find(uf, entry.parent);
	uf.set(id, { parent: root, rank: entry.rank });
	return root;
};

const congruent = (arena: ArenaState, uf: Map<EnodeId, UnionFindEntry>, a: EnodeId, b: EnodeId): boolean => {
	const nodeA = arena.nodes.get(a);
	const nodeB = arena.nodes.get(b);

	if (!nodeA || !nodeB) {
		return false;
	}

	if (nodeA.head !== nodeB.head) {
		return false;
	}

	if (nodeA.args.length !== nodeB.args.length) {
		return false;
	}
	return nodeA.args.every((argA, i) => find(uf, argA) === find(uf, nodeB.args[i]));
};

const merge = (state: CCState, arena: ArenaState, a: EnodeId, b: EnodeId, reason: Literal): TheoryCheck => {
	const rootA = find(state.uf, a);
	const rootB = find(state.uf, b);

	if (rootA === rootB) {
		return E.right([]);
	}

	state.mergeLog.push({ a, b, reason });

	const entryA = state.uf.get(rootA) ?? { parent: rootA, rank: 0 };
	const entryB = state.uf.get(rootB) ?? { parent: rootB, rank: 0 };

	const [winner, loser] = entryA.rank >= entryB.rank ? [rootA, rootB] : [rootB, rootA];
	state.uf.set(loser, { parent: winner, rank: state.uf.get(loser)?.rank ?? 0 });
	if (entryA.rank === entryB.rank) {
		state.uf.set(winner, { parent: winner, rank: entryA.rank + 1 });
	}

	const loserParents = state.parents.get(loser) ?? new Set();
	const winnerParents = state.parents.get(winner) ?? new Set();

	const propagations: TheoryPropagation[] = [];

	for (const pA of winnerParents) {
		for (const pB of loserParents) {
			if (find(state.uf, pA) !== find(state.uf, pB) && congruent(arena, state.uf, pA, pB)) {
				const congResult = merge(state, arena, pA, pB, reason);

				if (E.isLeft(congResult)) {
					return congResult;
				}
				propagations.push(...congResult.right);
			}
		}
	}

	loserParents.forEach(p => winnerParents.add(p));
	state.parents.set(winner, winnerParents);

	return E.right(propagations);
};

const explain = (state: CCState, a: EnodeId, b: EnodeId): readonly Literal[] => {
	if (find(state.uf, a) !== find(state.uf, b)) {
		return [];
	}

	const reasons: Literal[] = [];
	const visited = new Set<string>();
	const queue: [EnodeId, EnodeId][] = [[a, b]];

	while (queue.length > 0) {
		const [x, y] = queue[0];
		queue.splice(0, 1);
		const key = `${Math.min(x, y)},${Math.max(x, y)}`;

		if (visited.has(key)) {
			continue;
		}
		visited.add(key);

		const step = state.mergeLog.find(
			m =>
				(find(state.uf, m.a) === find(state.uf, x) && find(state.uf, m.b) === find(state.uf, y)) ||
				(find(state.uf, m.a) === find(state.uf, y) && find(state.uf, m.b) === find(state.uf, x)),
		);

		if (step) {
			reasons.push(step.reason);

			if (step.a !== x) {
				queue.push([x, step.a]);
			}

			if (step.b !== y) {
				queue.push([step.b, y]);
			}
		}
	}

	return [...new Set(reasons)];
};

const assertLiteral = (state: CCState, arena: ArenaState, literal: Literal): TheoryCheck => {
	const mapping = state.literalMap.get(literal);

	if (!mapping) {
		return E.right([]);
	}

	if (mapping.positive) {
		return merge(state, arena, mapping.a, mapping.b, literal);
	}

	if (find(state.uf, mapping.a) === find(state.uf, mapping.b)) {
		const justification = explain(state, mapping.a, mapping.b);
		return E.left({
			clause: {
				id: THEORY_CLAUSE_ID,
				literals: [...justification.map(negate), negate(literal)],
				origin: "euf:disequality-conflict",
			},
		});
	}

	return E.right([]);
};

const check = (state: CCState): TheoryCheck => {
	for (const [lit, mapping] of state.literalMap.entries()) {
		if (!mapping.positive && find(state.uf, mapping.a) === find(state.uf, mapping.b)) {
			const justification = explain(state, mapping.a, mapping.b);
			return E.left({
				clause: {
					id: THEORY_CLAUSE_ID,
					literals: [...justification.map(negate), negate(lit)],
					origin: "euf:disequality-conflict",
				},
			});
		}
	}

	const props = [...state.pendingPropagations];
	state.pendingPropagations.length = 0;
	return E.right(props);
};

const push = (state: CCState): void => {
	state.stateStack.push({
		ufSnapshot: new Map([...state.uf].map(([k, v]) => [k, { ...v }])),
		mergeLogLength: state.mergeLog.length,
	});
};

const pop = (state: CCState): void => {
	const snapshot = state.stateStack.pop();

	if (!snapshot) {
		return;
	}

	state.uf.clear();
	snapshot.ufSnapshot.forEach((v, k) => state.uf.set(k, v));
	state.mergeLog.length = snapshot.mergeLogLength;
};

const explainLiteral = (state: CCState, literal: Literal): readonly Literal[] => {
	const mapping = state.literalMap.get(literal);

	if (!mapping) {
		return [];
	}
	return explain(state, mapping.a, mapping.b);
};
