/* eslint-disable @typescript-eslint/no-namespace */
// Encode grounded quantifier lemmas against the v2 CNF atom table.
// MBQI = Model-Based Quantifier Instantiation.
// https://github.com/tiansivive/z-yap/blob/main/zettels/complementary-atom-encoding.md

import { match, P } from "ts-pattern";
import type { IVL } from "../../ivl/types";
import type * as CDCL from "../cdcl";
import type * as Enc from "../encoding";

const COMPLEMENT: Map<IVL.AtomOp, IVL.AtomOp> = new Map([
	["=", "!="],
	["!=", "="],
	["<", ">="],
	[">=", "<"],
	["<=", ">"],
	[">", "<="],
]);

export const encode = (state: Enc.State, formula: IVL.Formula): CDCL.Literal[] =>
	match(formula)
		.with({ tag: "Atom" }, atom => Atom.literals(state, atom.op, atom.args))
		.with({ tag: "Not" }, ({ value }) => encode(state, value).map(lit => -lit))
		.with({ tag: "And" }, ({ values }) => values.flatMap(v => encode(state, v)))
		.with(P.union({ tag: "True" }, { tag: "False" }), () => [])
		.otherwise(() => []);

namespace Atom {
	export const literals = (state: Enc.State, op: IVL.AtomOp, args: [IVL.Term, IVL.Term]): CDCL.Literal[] =>
		match(find(state, op, args))
			.with(P.number, lit => [lit])
			.with(undefined, () => complement(state, op, args))
			.exhaustive();

	const complement = (state: Enc.State, op: IVL.AtomOp, args: [IVL.Term, IVL.Term]): CDCL.Literal[] =>
		match(COMPLEMENT.get(op))
			.with(P.string, c =>
				match(find(state, c, args))
					.with(P.number, lit => [-lit])
					.with(undefined, () => [])
					.exhaustive(),
			)
			.with(undefined, () => [])
			.exhaustive();

	const find = (state: Enc.State, op: IVL.AtomOp, args: [IVL.Term, IVL.Term]): CDCL.Literal | undefined =>
		state.atoms.entries().find(([, atom]) => atom.op === op && equal(atom.args[0], args[0]) && equal(atom.args[1], args[1]))?.[0];
}

const equal = (a: IVL.Term, b: IVL.Term): boolean => a.tag === b.tag && JSON.stringify(a) === JSON.stringify(b);
