import * as EB from "@yap/elaboration";
import { match } from "ts-pattern";
import { Patterns } from "../patterns";

/** Free de Bruijn indices in term (indices >= depth). depth = number of lambda binders we're inside. */
export function freeVars(term: EB.Term, depth: number): Set<number> {
	return match(term)
		.with(Patterns.Vars.Bound, ({ variable }) => (variable.index >= depth ? new Set<number>([variable.index]) : new Set<number>()))
		.with({ type: "Var" }, () => new Set<number>())
		.with({ type: "Lit" }, () => new Set<number>())
		.with({ type: "Abs" }, ({ body }) => {
			const inner = freeVars(body, depth + 1);
			inner.delete(depth);
			return inner;
		})
		.with({ type: "App" }, ({ func, arg }) => {
			const a = freeVars(func, depth);
			const b = freeVars(arg, depth);
			return new Set<number>([...a, ...b]);
		})
		.with({ type: "Row" }, ({ row }) => freeVarsRow(row, depth))
		.with({ type: "Proj" }, ({ term: t }) => freeVars(t, depth))
		.with({ type: "Inj" }, ({ value: v, term: t }) => {
			const a = freeVars(v, depth);
			const b = freeVars(t, depth);
			return new Set<number>([...a, ...b]);
		})
		.with({ type: "Match" }, ({ scrutinee, alternatives }) => {
			let s = freeVars(scrutinee, depth);
			for (const alt of alternatives) {
				s = new Set<number>([...s, ...freeVars(alt.term, depth)]);
			}
			return s;
		})
		.with({ type: "Block" }, ({ statements, return: ret }) => {
			let s = freeVars(ret, depth);
			for (const stmt of statements) {
				if (stmt.type === "Expression") {
					s = new Set<number>([...s, ...freeVars(stmt.value, depth)]);
				} else if (stmt.type === "Let" || stmt.type === "Using") {
					s = new Set<number>([...s, ...freeVars(stmt.value, depth)]);
				}
			}
			return s;
		})
		.with({ type: "Modal" }, ({ term: t }) => freeVars(t, depth))
		.with({ type: "Reset" }, ({ term: t }) => freeVars(t, depth))
		.with({ type: "Shift" }, ({ body }) => freeVars(body, depth))
		.exhaustive();
}

function freeVarsRow(row: EB.Row, depth: number): Set<number> {
	return match(row)
		.with(Patterns.Rows.Extension, ({ value, row: rest }) => {
			const a = freeVars(value, depth);
			const b = freeVarsRow(rest, depth);
			return new Set<number>([...a, ...b]);
		})
		.with(Patterns.Rows.Variable, () => new Set<number>())
		.with(Patterns.Rows.Empty, () => new Set<number>())
		.exhaustive();
}

/** Deterministic sorted array from set of numbers. */
export const sortedNumbers = (set: Set<number>): number[] => [...set].sort((a, b) => a - b);
