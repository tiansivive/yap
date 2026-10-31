import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { update } from "@yap/utils";

type Reset = Extract<Src.Term, { type: "reset" }>;

export const infer = (reset: Reset): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: reset, metadata: { action: "infer", description: "Reset" } }, function* () {
		const ctx = yield* M.reader.ask();
		if (reset.identity) {
			const resolved = yield* EB.Control.identity(reset.identity);
			const [payload, result] = yield* EB.Control.signature(resolved.carrier, true);
			const answer = NF.Constructors.Flex(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const continuation = NF.Constructors.Pi("v", "Explicit", result, yield* NF.closeVal(answer));
			const expected = NF.Constructors.Pi("k", "Explicit", continuation, yield* NF.closeVal(answer));
			yield* M.constrain({ type: "assign", left: payload, right: expected, lvl: ctx.env.length });
			const [body, usages] = yield* M.reader.local(c => ({ ...c, implicits: [[resolved.atom, resolved.atom], ...c.implicits] }), EB.check(reset.term, answer));
			return [EB.Constructors.Reset(body, resolved.term, application()), answer, usages];
		}

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
			level: ctx.env.length,
			answer: {
				initial: NF.Constructors.Var(metaA),
				final: NF.Constructors.Var(metaR),
			},
			shifted: false,
		};
		yield* M.st.modify(update("delimitations", ds => [d, ...ds]));

		const [tm, us] = yield* M.reader.local(
			c => ({ ...c, implicits: [[EB.Control.anonymous, EB.Control.anonymous], ...c.implicits] }),
			EB.check(reset.term, d.answer.initial),
		);
		const {
			delimitations: [{ shifted, next }],
		} = yield* M.st.get();
		if (next) {
			yield* M.constrain({ type: "assign", left: d.answer.initial, right: next, lvl: ctx.env.length });
		} else if (!shifted) {
			// No shifts were used, so initial and final answer types must be the same
			yield* M.constrain({ type: "assign", left: d.answer.initial, right: d.answer.final, lvl: ctx.env.length });
		}

		yield* M.st.modify(update("delimitations", ([_d, ...ds]) => ds));
		return [EB.Constructors.Reset(tm, undefined, application()), d.answer.final, us] satisfies EB.AST;
	});

export const application = (): EB.Term =>
	EB.Constructors.Lambda(
		"$payload",
		"Explicit",
		EB.Constructors.Lambda("$k", "Explicit", EB.Constructors.App("Explicit", EB.Constructors.Var(EB.Bound(1)), EB.Constructors.Var(EB.Bound(0))), EB.Any),
		EB.Any,
	);
