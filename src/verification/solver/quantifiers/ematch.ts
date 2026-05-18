// E-matching: searches the EUF term arena for ground instances matching trigger
// patterns modulo the current congruence relation. Produces substitutions for
// quantifier instantiation.
// https://github.com/tiansivive/z-yap/blob/main/zettels/e-matching.md
// EUF = Equality with Uninterpreted Functions

import { match } from "ts-pattern";
import type { IVL } from "../ivl/types";
import type { EnodeId, Enode, ArenaState } from "../theories/euf/arena";

export type Substitution = ReadonlyMap<string, EnodeId>;

export type MatchResult = {
	readonly substitutions: readonly Substitution[];
};

export const EMatch = {
	single: (pattern: IVL.Term, arena: ArenaState, find: (id: EnodeId) => EnodeId): MatchResult => {
		const substitutions: Substitution[] = [];

		arena.nodes.forEach(node => {
			const sub = matchTerm(pattern, node.id, arena, find, new Map());

			if (sub) {
				substitutions.push(sub);
			}
		});

		return { substitutions };
	},

	multi: (patterns: readonly IVL.Term[], arena: ArenaState, find: (id: EnodeId) => EnodeId): MatchResult => {
		if (patterns.length === 0) {
			return { substitutions: [] };
		}

		if (patterns.length === 1) {
			return EMatch.single(patterns[0], arena, find);
		}

		const first = EMatch.single(patterns[0], arena, find);

		return {
			substitutions: first.substitutions.flatMap(sub =>
				patterns.slice(1).reduce<readonly Substitution[]>((acc, pattern) => acc.flatMap(s => extendMatch(pattern, arena, find, s)), [sub]),
			),
		};
	},
};

const matchTerm = (
	pattern: IVL.Term,
	target: EnodeId,
	arena: ArenaState,
	find: (id: EnodeId) => EnodeId,
	current: Map<string, EnodeId>,
): Substitution | undefined =>
	match(pattern)
		.with({ tag: "Var" }, ({ name }) => {
			const existing = current.get(name);
			if (existing !== undefined) {
				return find(existing) === find(target) ? new Map(current) : undefined;
			}
			const extended = new Map(current);
			extended.set(name, target);
			return extended;
		})
		.with({ tag: "App" }, ({ head, args }) => {
			const node = arena.nodes.get(target);

			if (!node) {
				return undefined;
			}

			if (node.head !== head) {
				return undefined;
			}

			if (node.args.length !== args.length) {
				return undefined;
			}

			return args.reduce<Substitution | undefined>((acc, argPattern, i) => {
				if (!acc) {
					return undefined;
				}
				return matchTerm(argPattern, node.args[i], arena, find, new Map(acc));
			}, new Map(current));
		})
		.with({ tag: "Const" }, ({ name }) => {
			const node = arena.nodes.get(target);

			if (!node) {
				return undefined;
			}
			return node.head === name && node.args.length === 0 ? new Map(current) : undefined;
		})
		.with({ tag: "Num" }, ({ value }) => {
			const node = arena.nodes.get(target);

			if (!node) {
				return undefined;
			}
			return node.head === value && node.args.length === 0 ? new Map(current) : undefined;
		})
		.otherwise(() => undefined);

const extendMatch = (pattern: IVL.Term, arena: ArenaState, find: (id: EnodeId) => EnodeId, current: Substitution): readonly Substitution[] => {
	const results: Substitution[] = [];

	arena.nodes.forEach(node => {
		const sub = matchTerm(pattern, node.id, arena, find, new Map(current));

		if (sub) {
			results.push(sub);
		}
	});

	return results;
};
