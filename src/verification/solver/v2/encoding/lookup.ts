// Lookup projects ground formulas into the existing v2 CNF atom table.
// https://github.com/tiansivive/z-yap/blob/main/zettels/complementary-atom-encoding.md

import { match, P } from "ts-pattern";
import { Patterns } from "../../ivl/patterns";
import type { IVL } from "../../ivl/types";
import type * as CDCL from "../cdcl";
import type * as Enc from "./model";

const COMPLEMENT: ReadonlyMap<IVL.AtomOp, IVL.AtomOp> = new Map([
	["=", "!="],
	["!=", "="],
	["<", ">="],
	[">=", "<"],
	["<=", ">"],
	[">", "<="],
]);

export const literals = (state: Enc.State, formula: IVL.Formula): readonly CDCL.Literal[] =>
	match(formula)
		.with(Patterns.Formula.Atom, atom => atomLiterals(state, atom.op, atom.args))
		.with(Patterns.Formula.Not, ({ value }) => literals(state, value).map(lit => -lit))
		.with(Patterns.Formula.And, ({ values }) => values.flatMap(v => literals(state, v)))
		.with(P.union(Patterns.Formula.True, Patterns.Formula.False), () => [])
		.otherwise(() => []);

const atomLiterals = (state: Enc.State, op: IVL.AtomOp, args: readonly [IVL.Term, IVL.Term]): readonly CDCL.Literal[] =>
	match(find(state, op, args))
		.with(P.number, lit => [lit])
		.with(undefined, () => complement(state, op, args))
		.exhaustive();

const complement = (state: Enc.State, op: IVL.AtomOp, args: readonly [IVL.Term, IVL.Term]): readonly CDCL.Literal[] =>
	match(COMPLEMENT.get(op))
		.with(P.string, c =>
			match(find(state, c, args))
				.with(P.number, lit => [-lit])
				.with(undefined, () => [])
				.exhaustive(),
		)
		.with(undefined, () => [])
		.exhaustive();

const find = (state: Enc.State, op: IVL.AtomOp, args: readonly [IVL.Term, IVL.Term]): CDCL.Literal | undefined =>
	Array.from(state.atoms.entries()).find(([, atom]) => atom.op === op && equal(atom.args[0], args[0]) && equal(atom.args[1], args[1]))?.[0];

const equal = (a: IVL.Term, b: IVL.Term): boolean => a.tag === b.tag && JSON.stringify(a) === JSON.stringify(b);
