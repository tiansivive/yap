import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { update } from "@yap/utils";

type Reset = Extract<Src.Term, { type: "reset" }>;

export const infer = (reset: Reset): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: reset, metadata: { action: "infer", description: "Reset" } }, function* () {
		const ctx = yield* M.reader.ask();

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

		const d: M.Delimitation = {
			answer: {
				initial: NF.Constructors.Var(metaA),
				final: NF.Constructors.Var(metaR),
			},
			shifted: false,
		};
		yield* M.st.modify(update("delimitations", ds => [d, ...ds]));

		const { registry } = yield* M.st.get();
		const [tm, us] = yield* M.reader.local(
			update("metas", ms => ({ ...ms, ...Metas.asContext(registry) })),
			EB.check(reset.term, d.answer.initial),
		);
		const {
			delimitations: [{ shifted }],
		} = yield* M.st.get();
		if (!shifted) {
			// No shifts were used, so initial and final answer types must be the same
			yield* M.constrain({ type: "assign", left: d.answer.initial, right: d.answer.final, lvl: ctx.env.length });
		}

		yield* M.st.modify(update("delimitations", ([_d, ...ds]) => ds));
		return [EB.Constructors.Reset(tm), d.answer.final, us] satisfies EB.AST;
	});
