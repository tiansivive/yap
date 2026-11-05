import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { match } from "ts-pattern";
import * as Lit from "@yap/shared/literals";
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
		const answer = { initial: NF.Constructors.Var(metaA), final: NF.Constructors.Var(metaR) };

		const d: M.Delimitation = {
			identity: NF.Constructors.Atom(`$anonymous${yield* M.supply.fresh("skolem")}`),
			carrier: yield* carrier(answer.initial, answer.final),
			answer,
			shifted: false,
		};
		yield* M.st.modify(update("delimitations", ds => [d, ...ds]));

		const [tm, us] = yield* EB.check(reset.term, d.answer.initial);
		const {
			delimitations: [{ shifted }],
		} = yield* M.st.get();
		if (!shifted) {
			// No shifts were used, so initial and final answer types must be the same
			yield* M.constrain({ type: "assign", left: d.answer.initial, right: d.answer.final, lvl: ctx.env.length });
		}

		yield* M.st.modify(update("delimitations", ([_d, ...ds]) => ds));
		return [
			EB.Constructors.Reset(tm, yield* NF.quote(ctx.env.length, d.identity), yield* application(d.carrier, d.answer.final)),
			d.answer.final,
			us,
		] satisfies EB.AST;
	});

/*
 * An anonymous reset's captures send a function of the continuation, and each capture may resume with its own type:
 * `(r: Type) => Effect ((r -> initial) -> final) r`.
 */
function* carrier(initial: NF.Value, final: NF.Value): M.Elaboration<NF.Value> {
	const lvl = (yield* M.reader.ask()).env.length;
	const r = EB.Constructors.Var({ type: "Bound", index: 0 });
	const continuation = EB.Constructors.Pi("x", "Explicit", r, yield* NF.quote(lvl + 2, initial));
	const payload = EB.Constructors.Pi("k", "Explicit", continuation, yield* NF.quote(lvl + 2, final));
	const effect = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", EB.Constructors.Lit(Lit.Atom("Effect")), payload), r);
	return yield* NF.evaluate(EB.Constructors.Pi("r", "Implicit", yield* NF.quote(lvl, NF.Type), effect));
}

/*
 * The handler applies the payload to the continuation. It is typed at a rigid instance of the carrier and bound with
 * that type, as a `with` handler is, so that verification checks it:
 *
 *   { let $handler: P -> (r -> initial) -> final = \$payload $k -> $payload $k; return $handler; }
 */
function* application(carrier: NF.Value, final: NF.Value): M.Elaboration<EB.Term> {
	const lvl = (yield* M.reader.ask()).env.length;
	const [payload] = yield* EB.Control.signature(carrier, true);
	const continuation = match(payload)
		.with({ type: "Abs", binder: { type: "Pi" } }, ({ binder }) => binder.annotation)
		.otherwise(() => {
			throw new Error("An anonymous reset's payload is a function of the continuation");
		});
	const type = NF.Constructors.Pi(
		"$payload",
		"Explicit",
		payload,
		yield* NF.closeVal(NF.Constructors.Pi("$k", "Explicit", continuation, yield* NF.closeVal(final))),
	);

	const apply = EB.Constructors.App("Explicit", EB.Constructors.Var({ type: "Bound", index: 1 }), EB.Constructors.Var({ type: "Bound", index: 0 }));
	const handler = EB.Constructors.Lambda(
		"$payload",
		"Explicit",
		EB.Constructors.Lambda("$k", "Explicit", apply, yield* NF.quote(lvl + 2, continuation)),
		yield* NF.quote(lvl + 1, payload),
	);
	return EB.Constructors.Block([EB.Constructors.Stmt.Let("$handler", handler, type)], EB.Constructors.Var({ type: "Bound", index: 0 }));
}
