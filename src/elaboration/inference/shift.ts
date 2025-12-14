import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

type Shift = Extract<Src.Term, { type: "shift" }>;

export const infer = (shift: Shift): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: shift, metadata: { action: "infer", description: "Shift" } },
		V2.Do<EB.AST, EB.AST>(function* () {
			const ctx = yield* V2.ask();

			// Get the current handler from the context
			if (ctx.handlers.length === 0) {
				throw new Error("shift without enclosing reset");
			}

			const [handler, ...restHandlers] = ctx.handlers;

			// Infer the value being shifted
			const [valueTerm, valueType, valueUsages] = yield* EB.infer.gen(shift.term);

			// The key insight: shift needs to capture the continuation.
			// The continuation represents "what comes next" in the computation.
			// In a proper implementation, this requires CPS transformation of the entire
			// enclosed term within reset.
			//
			// Current approach: We store the handler in the Shift term itself.
			// During evaluation, shift will need to:
			// 1. Capture the evaluation stack frames up to the nearest reset
			// 2. Bundle those frames into a callable continuation
			// 3. Apply the handler to the continuation and the shifted value
			//
			// The Shift term will contain:
			// - The shifted value
			// - The handler (retrieved from context)
			// This allows the evaluator to have all info needed to capture the continuation.

			// Create a fresh meta for the answer and result types
			const answerTypeMeta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const resultTypeMeta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));

			const answerType = NF.evaluate(ctx, answerTypeMeta);
			const resultType = NF.evaluate(ctx, resultTypeMeta);

			// Store both the handler and the value in the shift term
			// The evaluator will use these to construct and apply the continuation
			// Build: (handler, value) pair
			const pair = EB.Constructors.App(
				"Explicit",
				EB.Constructors.App("Explicit", EB.Constructors.Lit({ type: "Atom", value: "ShiftPair" }), handler),
				valueTerm,
			);

			const tm = EB.Constructors.Shift(pair);

			// The type of shift is the result type R
			const ty = resultType;

			return [tm, ty, valueUsages] as EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
