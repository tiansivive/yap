// Stable keys for v2 CNF atom deduplication.
// IVL = Intermediate Verification Language.
// https://github.com/tiansivive/z-yap/blob/main/zettels/tseitin-cnf.md

import { match } from "ts-pattern";
import type { IVL } from "../../ivl/types";

export const atom = (op: IVL.AtomOp, args: [IVL.Term, IVL.Term]): string => `(${op} ${term(args[0])} ${term(args[1])})`;

export const term = (value: IVL.Term): string =>
	match(value)
		.with({ tag: "Var" }, ({ name }) => name)
		.with({ tag: "Const" }, ({ name }) => name)
		.with({ tag: "Num" }, ({ value }) => value)
		.with({ tag: "Bool" }, ({ value }) => String(value))
		.with({ tag: "Str" }, ({ value }) => `"${value}"`)
		.with({ tag: "App" }, ({ head, args }) => `(${head} ${args.map(term).join(" ")})`)
		.with({ tag: "Arith" }, ({ op, args }) => `(${op} ${term(args[0])} ${term(args[1])})`)
		.with({ tag: "Select" }, ({ array, index }) => `(select ${term(array)} ${term(index)})`)
		.with({ tag: "Row" }, ({ row }) => `(row ${rows(row)})`)
		.exhaustive();

const rows = (row: IVL.RowTerm): string =>
	match(row)
		.with({ tag: "Empty" }, () => "()")
		.with({ tag: "Var" }, ({ name }) => name)
		.with({ tag: "Extend" }, ({ label, value, rest }) => `(${label} ${term(value)} ${rows(rest)})`)
		.exhaustive();
