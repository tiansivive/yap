// Encoding v2 domain model: boolean abstraction of IVL formulas.
// CNF = Conjunctive Normal Form; Tseitin proxies preserve formula structure.
// https://github.com/tiansivive/z-yap/blob/main/zettels/tseitin-cnf.md

import type { IVL } from "../ivl/types";
import type { Clause, Literal, Variable } from "./cdcl";
import * as Core from "./core";

export namespace Atom {
	export type Key = string;

	export type T = {
		readonly op: IVL.AtomOp;
		readonly args: readonly [IVL.Term, IVL.Term];
	};
}

export type Proxy =
	| { readonly tag: "and"; readonly operands: readonly Literal[] }
	| { readonly tag: "or"; readonly operands: readonly Literal[] }
	| { readonly tag: "implies"; readonly operands: readonly Literal[] }
	| { readonly tag: "true"; readonly operands: readonly [] }
	| { readonly tag: "false"; readonly operands: readonly [] }
	| { readonly tag: "forall"; readonly operands: readonly [] }
	| { readonly tag: "exists"; readonly operands: readonly [] };

export type State = {
	readonly clauses: readonly Clause.T[];
	readonly keyIndex: ReadonlyMap<Atom.Key, Literal>;
	readonly atoms: ReadonlyMap<Literal, Atom.T>;
	readonly proxies: ReadonlyMap<Variable, Proxy>;
	readonly nextVar: Variable;
};

export const Encoding = {
	empty: {
		clauses: [],
		keyIndex: new Map(),
		atoms: new Map(),
		proxies: new Map(),
		nextVar: 1,
	} satisfies State,

	fresh: function* (): Core.G<Variable> {
		const s = yield* Core.State.get();
		const variable = s.encoding.nextVar;
		yield* Core.State.modify(st => ({ ...st, encoding: { ...st.encoding, nextVar: variable + 1 } }));
		return variable;
	},
};

export const Atoms = {
	register: (key: Atom.Key, literal: Literal, atom: Atom.T) =>
		Core.State.modify(s => ({
			...s,
			encoding: {
				...s.encoding,
				keyIndex: new Map([...s.encoding.keyIndex, [key, literal]]),
				atoms: new Map([...s.encoding.atoms, [literal, atom]]),
			},
		})),
};

export const Proxies = {
	register: (variable: Variable, proxy: Proxy) =>
		Core.State.modify(s => ({
			...s,
			encoding: {
				...s.encoding,
				proxies: new Map([...s.encoding.proxies, [variable, proxy]]),
			},
		})),
};
