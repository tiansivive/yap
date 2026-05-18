// Tseitin transformation: converts an arbitrary formula to equisatisfiable CNF
// by introducing proxy variables for each sub-formula, preserving origin metadata.
// https://github.com/tiansivive/z-yap/blob/main/zettels/tseitin-cnf.md
// CNF = Conjunctive Normal Form

import { match } from "ts-pattern";
import { IVL } from "./ivl/types";
import type { Clause, Literal, Variable } from "./cdcl/core";

export type AtomInfo = {
	readonly op: IVL.AtomOp;
	readonly args: readonly [IVL.Term, IVL.Term];
};

export type CNFResult = {
	readonly clauses: readonly Clause[];
	readonly atoms: ReadonlyMap<Literal, AtomInfo>;
	readonly nextVar: Variable;
};

type AtomKey = string;

type TseitinState = {
	readonly clauses: readonly Clause[];
	readonly keyIndex: ReadonlyMap<AtomKey, Literal>;
	readonly atoms: ReadonlyMap<Literal, AtomInfo>;
	readonly nextVar: Variable;
	readonly nextClauseId: number;
};

export const tseitin = (formula: IVL.Formula): CNFResult => {
	const initial: TseitinState = { clauses: [], keyIndex: new Map(), atoms: new Map(), nextVar: 1, nextClauseId: 0 };
	const { literal: topLit, state } = encode(initial, formula);
	const final = addClause(state, [topLit], formula.origin ?? "top");

	return { clauses: final.clauses, atoms: final.atoms, nextVar: final.nextVar };
};

type EncodeResult = { readonly literal: Literal; readonly state: TseitinState };

const freshVar = (state: TseitinState): { v: Literal; state: TseitinState } => ({
	v: state.nextVar,
	state: { ...state, nextVar: state.nextVar + 1 },
});

const addClause = (state: TseitinState, literals: readonly Literal[], origin: string): TseitinState => ({
	...state,
	clauses: [...state.clauses, { id: state.nextClauseId, literals, origin }],
	nextClauseId: state.nextClauseId + 1,
});

const addAtom = (state: TseitinState, key: AtomKey, literal: Literal, info?: AtomInfo): TseitinState => ({
	...state,
	keyIndex: new Map([...state.keyIndex, [key, literal]]),
	atoms: info ? new Map([...state.atoms, [literal, info]]) : state.atoms,
});

const encode = (state: TseitinState, formula: IVL.Formula): EncodeResult =>
	match(formula)
		.with({ tag: "True" }, () => {
			const { v: p, state: s1 } = freshVar(state);
			return { literal: p, state: addClause(s1, [p], "true") };
		})
		.with({ tag: "False" }, () => {
			const { v: p, state: s1 } = freshVar(state);
			return { literal: p, state: addClause(s1, [-p], "false") };
		})
		.with({ tag: "Atom" }, ({ op, args }) => {
			const key = atomKey(op, args);
			const existing = state.keyIndex.get(key);

			if (existing !== undefined) {
				return { literal: existing, state };
			}

			const { v: p, state: s1 } = freshVar(state);
			return { literal: p, state: addAtom(s1, key, p, { op, args }) };
		})
		.with({ tag: "Not" }, ({ value }) => {
			const { literal: inner, state: s1 } = encode(state, value);
			return { literal: -inner, state: s1 };
		})
		.with({ tag: "And" }, ({ values, origin }) => {
			const { literals: subs, state: s1 } = encodeMany(state, values);
			const { v: p, state: s2 } = freshVar(s1);
			const orig = origin ?? "and";

			const s3 = subs.reduce((s, sub) => addClause(s, [-p, sub], orig), s2);
			const s4 = addClause(s3, [...subs.map(s => -s), p], orig);
			return { literal: p, state: s4 };
		})
		.with({ tag: "Or" }, ({ values, origin }) => {
			const { literals: subs, state: s1 } = encodeMany(state, values);
			const { v: p, state: s2 } = freshVar(s1);
			const orig = origin ?? "or";

			const s3 = addClause(s2, [-p, ...subs], orig);
			const s4 = subs.reduce((s, sub) => addClause(s, [-sub, p], orig), s3);
			return { literal: p, state: s4 };
		})
		.with({ tag: "Implies" }, ({ left, right, origin }) => {
			const { literal: l, state: s1 } = encode(state, left);
			const { literal: r, state: s2 } = encode(s1, right);
			const { v: p, state: s3 } = freshVar(s2);
			const orig = origin ?? "implies";

			const s4 = addClause(s3, [-p, -l, r], orig);
			const s5 = addClause(s4, [l, p], orig);
			const s6 = addClause(s5, [-r, p], orig);
			return { literal: p, state: s6 };
		})
		.with({ tag: "Forall" }, () => {
			const { v: p, state: s1 } = freshVar(state);
			return { literal: p, state: addAtom(s1, `forall:${p}`, p) };
		})
		.with({ tag: "Exists" }, () => {
			const { v: p, state: s1 } = freshVar(state);
			return { literal: p, state: s1 };
		})
		.exhaustive();

const encodeMany = (state: TseitinState, formulas: readonly IVL.Formula[]): { literals: readonly Literal[]; state: TseitinState } =>
	formulas.reduce<{ literals: readonly Literal[]; state: TseitinState }>(
		(acc, f) => {
			const { literal, state: s } = encode(acc.state, f);
			return { literals: [...acc.literals, literal], state: s };
		},
		{ literals: [], state },
	);

const atomKey = (op: IVL.AtomOp, args: [IVL.Term, IVL.Term]): AtomKey => `(${op} ${termKey(args[0])} ${termKey(args[1])})`;

const termKey = (term: IVL.Term): string =>
	match(term)
		.with({ tag: "Var" }, ({ name }) => name)
		.with({ tag: "Const" }, ({ name }) => name)
		.with({ tag: "Num" }, ({ value }) => value)
		.with({ tag: "Bool" }, ({ value }) => String(value))
		.with({ tag: "Str" }, ({ value }) => `"${value}"`)
		.with({ tag: "App" }, ({ head, args }) => `(${head} ${args.map(termKey).join(" ")})`)
		.with({ tag: "Arith" }, ({ op, args }) => `(${op} ${termKey(args[0])} ${termKey(args[1])})`)
		.with({ tag: "Select" }, ({ array, index }) => `(select ${termKey(array)} ${termKey(index)})`)
		.with({ tag: "Row" }, ({ row }) => `(row ${rowKey(row)})`)
		.exhaustive();

const rowKey = (row: IVL.RowTerm): string =>
	match(row)
		.with({ tag: "Empty" }, () => "()")
		.with({ tag: "Var" }, ({ name }) => name)
		.with({ tag: "Extend" }, ({ label, value, rest }) => `(${label} ${termKey(value)} ${rowKey(rest)})`)
		.exhaustive();
