import assert from "node:assert";
import { match } from "ts-pattern";
import type * as EB from "@yap/elaboration";
import * as M from "../monad";
import type * as C from "../context";
import { Patterns } from "../patterns";

export function* pushChildrenReversed(ctx: C.LowerCtx, terms: EB.Term[]): M.Glowering<void> {
	yield* M.traverse(terms.toReversed(), function* (term) {
		yield* M.Worklist.push({ type: "Lower", ctx, term });
	});
}

export const notImplemented = (what: string): M.Lowering<void> =>
	M.Do(function* () {
		return yield* M.fail<void>({ tag: "NotImplemented", what });
	});

export function extractFields(row: EB.Row): Array<{ label: string; term: EB.Term }> {
	return match(row)
		.with(Patterns.Rows.Extension, ({ label, value, row: rest }) => [{ label, term: value }, ...extractFields(rest)])
		.with(Patterns.Rows.Variable, () => {
			throw new Error("Row variable in value position — type-level only");
		})
		.with(Patterns.Rows.Empty, () => [])
		.exhaustive();
}
