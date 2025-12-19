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
			 * - A is the initial answer type
			 * 	- The return type of the continuation k
			 * 	- Intuitively represents the return type of the expression inside reset if there were no shifts
			 * - R is the final result type after handling shifts
			 * 	- The return type of the handler
			 * 	- Represents the actual return type of the entire reset expression
			 *  - Intuitively, R overrides A via the handler
			 ****************************************************/

			const metaA = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const metaR = yield* EB.freshMeta(ctx.env.length, NF.Type);

			const d: EB.Context["delimitations"][number] = {
				answer: {
					initial: NF.Constructors.Var(metaA),
					final: NF.Constructors.Var(metaR),
				},
			};
			const [tm, ty, usages] = yield* V2.local(
				_ctx => update(_ctx, "delimitations", ds => [d, ...ds]),
				V2.Do(function* () {
					const [term, type, usages] = yield* EB.infer.gen(reset.term);
					// const emitted = yield* V2.listen();
					return [term, type, usages] as EB.AST;
				}),
			);

			// Constrain the enclosed type to be the answer type
			// This ensures that the body of reset conforms to the expected answer type
			yield* V2.tell("constraint", { type: "assign", left: ty, right: d.answer.initial });

			// The final type of reset is the result type R tho!
			return [EB.Constructors.Reset(tm), d.answer.final, usages] as EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
