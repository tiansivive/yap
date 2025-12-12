import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as F from "fp-ts/lib/function";

type Reset = Extract<Src.Term, { type: "reset" }>;

/**
 * Elaborate reset h e:
 *
 * Surface syntax: reset h e
 * Desugars to: CoreReset(let __handler = h in e_desugared)
 *
 * The handler h should have type (A -> R) -> V -> R where:
 * - A is the answer type (the type that e returns when no shift occurs)
 * - V is the shift argument type
 * - R is the final result type of the whole reset expression
 *
 * Implementation strategy:
 * 1. Elaborate the body e to get its type A
 * 2. Create fresh metas for V and R
 * 3. Check handler against (A -> R) -> V -> R
 * 4. Return CoreReset with desugared body containing the handler binding
 */
export const infer = (reset: Reset): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: reset, metadata: { action: "infer", description: "Reset" } },
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const { handler, body } = reset;

			// Elaborate the body first to get the answer type A
			const [bodyTerm, bodyType, bodyUsages] = yield* EB.infer.gen(body);

			// Create fresh metas for the shift argument type V and result type R
			const vMeta = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const rMeta = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const vType = NF.Constructors.Neutral(NF.Constructors.Var(vMeta));
			const rType = NF.Constructors.Neutral(NF.Constructors.Var(rMeta));

			// Handler type: (A -> R) -> V -> R
			const contType = NF.Constructors.Pi(
				"k",
				"Explicit",
				bodyType,
				NF.Constructors.Closure(ctx, EB.Constructors.Var(EB.Constructors.Vars.Meta(rMeta.val, rMeta.lvl))),
			);
			const handlerType = NF.Constructors.Pi(
				"v",
				"Explicit",
				vType,
				NF.Constructors.Closure(ctx, EB.Constructors.Var(EB.Constructors.Vars.Meta(rMeta.val, rMeta.lvl))),
			);
			const fullHandlerType = NF.Constructors.Pi("k", "Explicit", contType, NF.Constructors.Closure(ctx, NF.quote(ctx, ctx.env.length, handlerType)));

			// Check the handler against the expected type
			const [handlerTerm] = yield* EB.check.gen(handler, fullHandlerType);

			// Desugar: reset h e → CoreReset(let __handler = h in e)
			// We bind the handler in the reset body so shift can access it
			const handlerVar = "__handler";
			const letStmt: EB.Statement = {
				type: "Let",
				variable: handlerVar,
				value: handlerTerm,
				annotation: fullHandlerType,
			};

			// Create the desugared body with the handler binding
			const desugaredBody = EB.Constructors.Block([letStmt], bodyTerm);

			// Create the core Reset term
			const resetTerm = EB.Constructors.Reset(desugaredBody);

			// The type of reset is R (the final result type)
			return [resetTerm, rType, Q.noUsage(ctx.env.length)] satisfies EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
