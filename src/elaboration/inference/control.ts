import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Src from "@yap/src/index";
import { OP_LIVE } from "@yap/shared/lib/primitives";
import { Liquid } from "@yap/verification/modalities";

type With = Extract<Src.Term, { type: "with" }>;
type Capture = Extract<Src.Term, { type: "capture" }>;

/**
 * `with E: h in body` delimits `body` for the identity `E`, whose carrier `Effect P R` types the handler
 * as `P -> (R -> A) -> A` with `A` the type of the whole expression. Clauses nest with the first outermost.
 */
export const infer = (node: With): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "With" } }, function* () {
		const answer = yield* fresh();
		const [term, usages] = yield* delimit(node, answer);
		return [term, answer, usages] satisfies EB.AST;
	});

export const check = (node: With, answer: NF.Value): M.Elaboration<[EB.Term, Q.Usages]> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "checking", against: answer } }, () => delimit(node, answer));

function* delimit(node: With, answer: NF.Value): M.Elaboration<[EB.Term, Q.Usages]> {
	const [clause, ...rest] = node.handlers;
	const [identity, carrier] = yield* EB.infer(clause.identity);
	const [payload, result] = yield* signature(carrier);

	const type = yield* arrow(payload, yield* arrow(yield* arrow(result, answer), answer));
	const [handler] = yield* EB.check(clause.handler, type);
	const [body, usages] = yield* EB.check(rest.length > 0 ? { ...node, handlers: rest } : node.term, answer);
	const annotated = EB.Constructors.Ann(handler, yield* NF.quote((yield* M.reader.ask()).env.length, type));

	return [EB.Constructors.Reset(body, identity, annotated), usages];
}

/**
 * `capture [E] p` sends `p : P` to the nearest handler for `E: Effect P R` and results in `R`. The payload is
 * annotated with a refinement that holds only where `E` is live, so verification proves it at the capture.
 */
export const capture = (node: Capture): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Capture" } }, function* () {
		const [identity, carrier] = yield* EB.infer(node.identity);
		const [payload, result] = yield* signature(carrier);
		const [value, usages] = yield* EB.check(node.term, payload);

		return [EB.Constructors.Capture(identity, EB.Constructors.Ann(value, yield* live(identity, payload, result))), result, usages] satisfies EB.AST;
	});

/* `P [| \st _ -> live st E |]` */
function* live(identity: EB.Term, payload: NF.Value, result: NF.Value): M.Elaboration<EB.Term> {
	const lvl = (yield* M.reader.ask()).env.length;
	const quoted = (value: NF.Value) => NF.quote(lvl + 2, value);
	const state = EB.Constructors.Var({ type: "Bound", index: 1 });

	const operation = EB.Constructors.App("Explicit", EB.Constructors.Var({ type: "Foreign", name: OP_LIVE }), state);
	const instantiated = EB.Constructors.App("Implicit", EB.Constructors.App("Implicit", operation, yield* quoted(payload)), yield* quoted(result));
	const body = EB.Constructors.App("Explicit", instantiated, yield* quoted(yield* NF.evaluate(identity)));

	const liquid = yield* Liquid.Predicate.Lambda(payload, body);
	return EB.Constructors.Modal(yield* NF.quote(lvl, payload), { quantity: Q.Many, liquid: yield* NF.quote(lvl, liquid) });
}

/* The payload and result of an identity's carrier, constraining an unknown carrier to `Effect P R`. */
function* signature(carrier: NF.Value): M.Elaboration<[NF.Value, NF.Value]> {
	const { value } = yield* NF.view(carrier);
	return yield* match(value)
		.with({ type: "App", func: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Effect" } } } }, function* ({ func, arg }) {
			return [func.arg, arg] satisfies [NF.Value, NF.Value];
		})
		.otherwise(function* () {
			const lvl = (yield* M.reader.ask()).env.length;
			const [payload, result] = [yield* fresh(), yield* fresh()];
			const effect = NF.Constructors.App(NF.Constructors.App(NF.Constructors.Lit({ type: "Atom", value: "Effect" }), payload, "Explicit"), result, "Explicit");
			yield* M.constrain({ type: "assign", left: carrier, right: effect, lvl });
			return [payload, result] satisfies [NF.Value, NF.Value];
		});
}

function* fresh(): M.Elaboration<NF.Value> {
	return NF.Constructors.Var(yield* EB.freshMeta((yield* M.reader.ask()).env.length, NF.Type));
}

function* arrow(from: NF.Value, to: NF.Value): M.Elaboration<NF.Value> {
	return NF.Constructors.Pi("x", "Explicit", from, yield* NF.closeVal(to));
}
