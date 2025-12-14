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

			// Create a fresh meta for the continuation type
			// The continuation has type A -> R where A is the answer type and R is the result type
			const answerTypeMeta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const resultTypeMeta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));

			const answerType = NF.evaluate(ctx, answerTypeMeta);
			const resultType = NF.evaluate(ctx, resultTypeMeta);

			// Build the elaborated shift term: shift (\k -> h k v)
			// where h is the handler, k is the continuation, and v is the value
			const kVar = "k";
			const kBound = EB.Constructors.Var({ type: "Bound", index: 0 });

			// Build: h k v
			const handlerAppK = EB.Constructors.App("Explicit", handler, kBound);
			const handlerAppKV = EB.Constructors.App("Explicit", handlerAppK, valueTerm);

			// Build the continuation type annotation: A -> R
			const contTypeAnnotation = EB.Constructors.Pi(kVar, "Explicit", answerTypeMeta, resultTypeMeta);

			// Build: \k -> h k v
			const contLambda = EB.Constructors.Lambda(kVar, "Explicit", handlerAppKV, contTypeAnnotation);

			const tm = EB.Constructors.Shift(contLambda);

			// The type of shift is the result type R
			const ty = resultType;

			return [tm, ty, valueUsages] as EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
