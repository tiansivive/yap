import * as F from "fp-ts/lib/function";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import * as Lit from "@yap/shared/literals";

import { update } from "@yap/utils";

type Reset = Extract<Src.Term, { type: "reset" }>;

export const infer = (reset: Reset): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: reset, metadata: { action: "infer", description: "Reset" } },
		V2.Do<EB.AST, EB.AST>(function* () {
			const ctx = yield* V2.ask();

			/****************************************************
			 * //TODO: ANSWER-TYPE POLYMORPHISM LOGIC
			 *
			 * The handler should be a function type: (k: P -> A) -> V -> R
			 *
			 * - A is the initial answer type
			 * 	- The return type of the continuation k
			 * 	- Intuitively represents the return type of the expression inside reset if there were no shifts
			 * - R is the final result type after handling shifts
			 * 	- The return type of the handler
			 * 	- Represents the actual return type of the entire reset expression
			 *  - Intuitively, R overrides A via the handler
			 * - P is the return type of the shift expression, or the type of the continuation parameter
			 * 	- Intuitively, to proceed with any continuation, a value of type P must be provided by the handler
			 *  - Inside a reset, shift expressions will evaluate to type P as that equates to calling the continuation k
			 * - V is the shift value type
			 * 	- Intuitively, the type of the value being shifted up to the handler
			 ****************************************************/

			const metaP = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const metaA = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const metaV = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const metaR = yield* EB.freshMeta(ctx.env.length, NF.Type);

			const kType = EB.Constructors.Pi("$p", "Explicit", EB.Constructors.Var(metaP), EB.Constructors.Var(metaA));
			const hBody = EB.Constructors.Pi("$v", "Explicit", EB.Constructors.Var(metaV), EB.Constructors.Var(metaR));
			const hType = EB.Constructors.Pi("$k", "Explicit", kType, hBody);

			const val = NF.evaluate(ctx, hType);
			const [hTerm, us] = yield* EB.check.gen(reset.handler, val);

			const h: EB.Context["handlers"][number] = {
				src: reset.handler,
				term: hTerm,
				type: val,
				answer: {
					initial: NF.Constructors.Var(metaA),
					final: NF.Constructors.Var(metaR),
				},
			};
			const [enclosedTerm, enclosedType, usages] = yield* V2.local(
				_ctx => update(_ctx, "handlers", hs => [h, ...hs]),
				V2.Do(function* () {
					const [term, type, usages] = yield* EB.infer.gen(reset.term);
					// const emitted = yield* V2.listen();
					return [term, type, usages] as EB.AST;
				}),
			);

			// Constrain the enclosed type to be the answer type
			// This ensures that the body of reset conforms to the expected answer type
			//yield* V2.tell("constraint", { type: "assign", left: enclosedType, right: NF.evaluate(ctx, EB.Constructors.Var(metaA)) });

			// The final type of reset is the result type R tho!
			return [EB.Constructors.Reset(enclosedTerm), enclosedType, Q.add(usages, usages)] as EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
