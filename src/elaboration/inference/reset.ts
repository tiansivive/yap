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

			const d: V2.Delimitation = {
				answer: {
					initial: NF.Constructors.Var(metaA),
					final: NF.Constructors.Var(metaR),
				},
				shifted: false,
			};
			//yield* V2.modifySt(update("delimitations", ds => [d, ...ds]))
			yield* V2.modifySt(update("delimitations", ds => [d, ...ds]));
			const [tm, us] = yield* EB.check.gen(reset.term, d.answer.initial);
			const {
				delimitations: [{ shifted }],
			} = yield* V2.getSt();
			if (!shifted) {
				// No shifts were used, so initial and final answer types must be the same
				yield* V2.tell("constraint", { type: "assign", left: d.answer.initial, right: d.answer.final });
			}

			yield* V2.modifySt(update("delimitations", ([d, ...ds]) => ds));

			return [EB.Constructors.Reset(tm), d.answer.final, us] satisfies EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
