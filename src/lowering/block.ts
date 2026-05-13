import assert from "node:assert";
import * as EB from "@yap/elaboration";
import { match } from "ts-pattern";
import * as M from "./monad";
import * as C from "./context";
import { notImplemented } from "./shared/helpers";

export const lower = (stmts: EB.Statement[], ret: EB.Term): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();

		if (stmts.length === 0) {
			yield* M.Worklist.push({ type: "Lower", ctx, term: ret });
			return;
		}

		const [head, ...rest] = stmts;
		assert(head);
		const tail = EB.Constructors.Block(rest, ret);

		yield match(head)
			.with(
				{ type: "Let" },
				({ variable, value }): M.Lowering<void> =>
					M.Do(function* () {
						// TODO(let-rec): yap's `let` is let-rec — the bound name is in scope of its
						// own value (see `src/elaboration/inference.v2/block.ts:46-53`). We currently
						// lower it as non-rec: the value is lowered with the OUTER ctx, so any
						// reference to the bound name inside the value will resolve to whatever
						// happens to be at that index in the outer scope (which is wrong). A proper
						// fix needs:
						//   1. Pre-allocate a binder, bind it in valueCtx before lowering value, so
						//      indices line up with the elaborator.
						//   2. For Shift specifically, switch to freeVars-based capture extraction
						//      so the let-rec placeholder doesn't leak into the env record (currently
						//      `Array.from(ctx.bound.values())` would capture it).
						//   3. For self-referencing closure values, allocate the closure's name
						//      up-front and patch the closure record's env in-place (knot-tying).
						//      Self-referencing non-closure values (`let x = x + 1`) would diverge
						//      at runtime; the docs note this is accepted until we add value-
						//      restriction or laziness.
						// Hand-coded test EB terms in the meantime should use non-rec indices in
						// places where the elaborator would have produced let-rec indices.
						yield* M.Worklist.push({
							type: "Cont",
							arity: 1,
							handler: ([valueR]) =>
								M.Do(function* () {
									assert(valueR);
									const binder = C.stampNamed(variable);
									const extended = C.bind(ctx, binder, new Map([[0, valueR.value]]));
									yield* M.Worklist.push({ type: "Lower", ctx: extended, term: tail });
								}),
						});
						yield* M.Worklist.push({ type: "Lower", ctx, term: value });
					}),
			)
			.with(
				{ type: "Expression" },
				({ value }): M.Lowering<void> =>
					M.Do(function* () {
						yield* M.Worklist.push({
							type: "Cont",
							arity: 1,
							handler: () =>
								M.Do(function* () {
									yield* M.Worklist.push({ type: "Lower", ctx, term: tail });
								}),
						});
						yield* M.Worklist.push({ type: "Lower", ctx, term: value });
					}),
			)
			.with({ type: "Using" }, () => notImplemented("Using statement"))
			.exhaustive();
	});
