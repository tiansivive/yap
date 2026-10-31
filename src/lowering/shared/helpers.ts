import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import * as M from "../monad";
import type * as C from "../context";

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
	assert(row.tail === undefined, "Row variable in value position — type-level only");
	return row.entries.map(({ label, value }) => ({ label, term: value }));
}
