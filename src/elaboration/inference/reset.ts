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
			return [EB.Constructors.Reset(body, resolved.term, yield* application(payload, continuation)), answer, usages];
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
		const identity = yield* EB.Control.anonymous();

		const d: M.Delimitation = {
			identity,
			level: ctx.env.length,
			answer: {
				initial: NF.Constructors.Var(metaA),
				final: NF.Constructors.Var(metaR),
			},
			shifted: false,
		};
		yield* M.st.modify(update("delimitations", ds => [d, ...ds]));

		const [[tm, us], { constraints }] = yield* M.writer.listen(
			M.reader.local(c => ({ ...c, implicits: [[identity, identity], ...c.implicits] }), EB.check(reset.term, d.answer.initial)),
		);
		const {
			delimitations: [{ shifted, next }],
		} = yield* M.st.get();
		const [, tail] = yield* M.writer.listen(
			(function* () {
				if (next) {
					yield* M.constrain({ type: "assign", left: d.answer.initial, right: next, lvl: ctx.env.length });
				} else if (!shifted) {
					yield* M.constrain({ type: "assign", left: d.answer.initial, right: d.answer.final, lvl: ctx.env.length });
				}
			})(),
		);

		yield* M.st.modify(update("delimitations", ([_d, ...ds]) => ds));
		const { resolutions } = yield* EB.solve([...constraints, ...tail.constraints]);
		yield* EB.Control.scoped(identity, d.answer.final, "anonymous");
		return [
			EB.Constructors.Reset(yield* EB.Icit.instantiate(tm, resolutions, false), yield* NF.quote(ctx.env.length, identity), yield* application()),
			d.answer.final,
			us,
		] satisfies EB.AST;
	});

export const application = function* (payload = NF.Any, continuation = NF.Any): M.Elaboration<EB.Term> {
	const ctx = yield* M.reader.ask();
	const annotation = yield* NF.quote(ctx.env.length, continuation);
	const lifted = EB.rewrite(annotation, (t, depth) =>
		t.type === "Var" && t.variable.type === "Bound" && t.variable.index >= depth ? EB.Constructors.Var(EB.Bound(t.variable.index + 1)) : t,
	);
	return EB.Constructors.Lambda(
		"$payload",
		"Explicit",
		EB.Constructors.Lambda("$k", "Explicit", EB.Constructors.App("Explicit", EB.Constructors.Var(EB.Bound(1)), EB.Constructors.Var(EB.Bound(0))), lifted),
		yield* NF.quote(ctx.env.length, payload),
	);
};
