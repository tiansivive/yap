// EUF term interning for v2: hash-conses IVL terms into enodes for cheap equality checks.
// EUF = Equality with Uninterpreted Functions; Enode = equality node.
// https://github.com/tiansivive/z-yap/blob/main/zettels/euf-theory.md

import { match, P } from "ts-pattern";
import { Build } from "../../ivl/build";
import type { IVL } from "../../ivl/types";

const Patterns = {
	Term: {
		App: { tag: "App" } as const,
		Var: { tag: "Var" } as const,
		Const: { tag: "Const" } as const,
		Num: { tag: "Num" } as const,
		Bool: { tag: "Bool" } as const,
		Str: { tag: "Str" } as const,
		Arith: { tag: "Arith" } as const,
		Select: { tag: "Select" } as const,
		Row: { tag: "Row" } as const,
	},
} as const;

export const Intern = {
	empty: {
		nodes: new Map(),
		hashIndex: new Map(),
		nextId: 0,
	} satisfies Intern.State,

	raw: (state: Intern.State, head: string, args: readonly Enode.Id[], sort: IVL.Sort): Intern.Result =>
		match(state.hashIndex.get(Key.enode(head, args)))
			.with(P.number, id => ({ id, state }))
			.with(undefined, () => {
				const id = state.nextId;
				const node: Enode.T = { id, head, args, sort };
				return {
					id,
					state: {
						nodes: new Map([...state.nodes, [id, node]]),
						hashIndex: new Map([...state.hashIndex, [Key.enode(head, args), id]]),
						nextId: id + 1,
					},
				};
			})
			.exhaustive(),

	term: (state: Intern.State, term: IVL.Term): Intern.Result =>
		match(term)
			.with(Patterns.Term.App, ({ head, args, sort }) => {
				const result = args.reduce<Intern.Many>(
					(acc, arg) => {
						const next = Intern.term(acc.state, arg);
						return { ids: [...acc.ids, next.id], state: next.state };
					},
					{ ids: [], state },
				);
				return Intern.raw(result.state, head, result.ids, sort);
			})
			.with(Patterns.Term.Var, ({ name, sort }) => Intern.raw(state, name, [], sort))
			.with(Patterns.Term.Const, ({ name, sort }) => Intern.raw(state, name, [], sort))
			.with(Patterns.Term.Num, ({ value, sort }) => Intern.raw(state, value, [], sort))
			.with(Patterns.Term.Bool, ({ value }) => Intern.raw(state, String(value), [], Build.Bool))
			.with(Patterns.Term.Str, ({ value }) => Intern.raw(state, value, [], Build.String))
			.with(Patterns.Term.Arith, ({ op, args, sort }) => {
				const left = Intern.term(state, args[0]);
				const right = Intern.term(left.state, args[1]);
				return Intern.raw(right.state, op, [left.id, right.id], sort);
			})
			.with(Patterns.Term.Select, ({ array, index, sort }) => {
				const source = Intern.term(state, array);
				const selected = Intern.term(source.state, index);
				return Intern.raw(selected.state, "select", [source.id, selected.id], sort);
			})
			.with(Patterns.Term.Row, ({ sort }) => Intern.raw(state, "row", [], sort))
			.exhaustive(),

	pair: (state: Intern.State, left: IVL.Term, right: IVL.Term): Intern.Pair => {
		const a = Intern.term(state, left);
		const b = Intern.term(a.state, right);
		return { left: a.id, right: b.id, state: b.state };
	},

	lookup: (state: Intern.State, id: Enode.Id): Enode.T | undefined => state.nodes.get(id),

	find: (state: Intern.State, head: string, args: readonly Enode.Id[]): Enode.Id | undefined => state.hashIndex.get(Key.enode(head, args)),
};

export namespace Intern {
	export type State = {
		readonly nodes: Map<Enode.Id, Enode.T>;
		readonly hashIndex: Map<string, Enode.Id>;
		readonly nextId: number;
	};

	export type Result = {
		readonly id: Enode.Id;
		readonly state: State;
	};

	export type Pair = {
		readonly left: Enode.Id;
		readonly right: Enode.Id;
		readonly state: State;
	};

	export type Many = {
		readonly ids: readonly Enode.Id[];
		readonly state: State;
	};
}

export namespace Enode {
	export type Id = number;

	export type T = {
		readonly id: Id;
		readonly head: string;
		readonly args: readonly Id[];
		readonly sort: IVL.Sort;
	};
}

export const Arena = {
	empty: Intern.empty,
};

export namespace Arena {
	export type State = Intern.State;
	export type Interned = Intern.Result;
}

const Key = {
	enode: (head: string, args: readonly Enode.Id[]): string =>
		match(args)
			.with([], () => head)
			.otherwise(values => `${head}(${values.join(",")})`),
};
