import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as F from "fp-ts/lib/function";

type Shift = Extract<Src.Term, { type: "shift" }>;

/**
 * Elaborate shift v:
 *
 * Surface syntax: shift v
 * Desugars to: CoreShift(v)
 *
 * The shift expression must appear inside a reset.
 * When encountered, it captures the continuation up to the enclosing reset.
 *
 * Type checking:
 * - Look up the nearest reset answer-type context (stored in elaboration context)
 * - v must have type V (the shift argument type)
 * - The shift expression has type A (the continuation domain / answer type)
 *
 * Implementation:
 * For now, we'll use a simple approach where shift carries the argument
 * and the actual continuation capture happens at runtime.
 * The type of shift is determined by the enclosing reset's answer type.
 */
export const infer = (shift: Shift): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: shift, metadata: { action: "infer", description: "Shift" } },
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const { arg } = shift;

			// For now, we'll create fresh metas for the shift argument type and answer type
			// In a more complete implementation, these would come from the enclosing reset context
			// TODO: Thread reset context through elaboration to get actual answer/shift types

			const answerTypeMeta = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const shiftArgTypeMeta = yield* EB.freshMeta(ctx.env.length, NF.Type);

			const answerType = NF.Constructors.Neutral(NF.Constructors.Var(answerTypeMeta));
			const shiftArgType = NF.Constructors.Neutral(NF.Constructors.Var(shiftArgTypeMeta));

			// Check the argument against the shift argument type
			const [argTerm] = yield* EB.check.gen(arg, shiftArgType);

			// Create the core Shift term
			const shiftTerm = EB.Constructors.Shift(argTerm);

			// The type of shift is the answer type (what the continuation expects)
			return [shiftTerm, answerType, Q.noUsage(ctx.env.length)] satisfies EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
