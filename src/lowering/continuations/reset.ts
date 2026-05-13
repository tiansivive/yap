import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import * as M from "../monad";
import type * as C from "../context";

export const lower = (term: EB.Term): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const resetExit = ctx.nextLabel("reset_exit");
		const innerCtx: C.LowerCtx = { ...ctx, resetCtx: { resetExit } };

		const state = yield* M.State.get();
		yield* M.Worklist.push({ type: "Delimiter", resultSize: state.results.length });
		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([bodyR]) =>
				M.Do(function* () {
					assert(bodyR);
					yield* M.Results.push(bodyR);
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx: innerCtx, term });
	});
