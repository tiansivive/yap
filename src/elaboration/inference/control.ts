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
	const [payload, result] = yield* signature(carrier, true);

	const continuation = yield* arrow(result, answer);
	const type = yield* arrow(payload, yield* arrow(continuation, answer));
	const [handler] = yield* EB.check(clause.handler, type);
	const [body, usages] = yield* EB.check(rest.length > 0 ? { ...node, handlers: rest } : node.term, answer);

	return [yield* install(identity, handler, body, { payload, result, continuation, handler: type }), usages];
}

/*
 * The handler receives a continuation that reinstalls the delimiter before resuming, which makes it deep:
 *
 *   reset [E] {
 *     let $user: P -> (R -> A) -> A = h;
 *     let $handler: P -> (R -> A) -> A = \$payload $k -> {
 *       let $deepK: R -> A = \$value -> reset [E] $handler ($k $value);
 *       return $user $payload $deepK;
 *     };
 *     return $handler;
 *   } body
 */
function* install(
	identity: EB.Term,
	handler: EB.Term,
	body: EB.Term,
	types: { payload: NF.Value; result: NF.Value; continuation: NF.Value; handler: NF.Value },
): M.Elaboration<EB.Term> {
	const lvl = (yield* M.reader.ask()).env.length;
	const v = (index: number) => EB.Constructors.Var({ type: "Bound", index });
	const app = (func: EB.Term, arg: EB.Term) => EB.Constructors.App("Explicit", func, arg);

	const deep = EB.Constructors.Lambda(
		"$value",
		"Explicit",
		EB.Constructors.Reset(app(v(2), v(0)), lift(identity, 6), v(4)),
		yield* NF.quote(lvl + 5, types.result),
	);
	const resumption = EB.Constructors.Block([EB.Constructors.Stmt.Let("$deepK", deep, types.continuation)], app(app(v(4), v(2)), v(0)));
	const installed = EB.Constructors.Lambda(
		"$payload",
		"Explicit",
		EB.Constructors.Lambda("$k", "Explicit", resumption, yield* NF.quote(lvl + 3, types.continuation)),
		yield* NF.quote(lvl + 2, types.payload),
	);

	const bindings = [EB.Constructors.Stmt.Let("$user", lift(handler, 1), types.handler), EB.Constructors.Stmt.Let("$handler", installed, types.handler)];
	return EB.Constructors.Reset(body, identity, EB.Constructors.Block(bindings, v(0)));
}

/* Moves a term under `amount` new binders. */
const lift = (term: EB.Term, amount: number): EB.Term =>
	EB.rewrite(term, (t, depth) =>
		t.type === "Var" && t.variable.type === "Bound" && t.variable.index >= depth ? EB.Constructors.Var({ type: "Bound", index: t.variable.index + amount }) : t,
	);

export const capture = (node: Capture): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Capture" } }, () =>
		node.identity ? named(node.identity, node.term) : anonymous(node.term),
	);

/**
 * `capture [E] p` sends `p : P` to the nearest handler for `E: Effect P R` and results in `R`. The payload is
 * expected at a type refined to hold only where `E` is live, so verification proves it at the capture.
 */
function* named(source: Src.Term, sent: Src.Term): M.Elaboration<EB.AST> {
	const [identity, carrier] = yield* EB.infer(source);
	const [payload, result] = yield* signature(carrier);
	const [value, usages] = yield* EB.check(sent, payload);
	const skolem = yield* EB.freshMeta((yield* M.reader.ask()).env.length, result);

	return [EB.Constructors.Bubble(skolem.val, result, yield* live(identity, payload, result), [], identity, value), result, usages] satisfies EB.AST;
}

/* `capture f` sends `f`, a function of the continuation, to the enclosing anonymous reset, whose handler applies it. */
function* anonymous(sent: Src.Term): M.Elaboration<EB.AST> {
	const { delimitations } = yield* M.st.get();
	const [delimitation, ...outer] = delimitations;
	if (!delimitation) {
		throw new Error("capture without an enclosing reset");
	}
	const lvl = (yield* M.reader.ask()).env.length;
	const [payload, result] = yield* signature(delimitation.carrier);
	yield* M.st.modify(s => ({ ...s, delimitations: [{ ...delimitation, shifted: true }, ...outer] }));

	const [value, usages] = yield* EB.check(sent, payload);
	const skolem = yield* EB.freshMeta(lvl, result);
	return [EB.Constructors.Bubble(skolem.val, result, payload, [], yield* NF.quote(lvl, delimitation.identity), value), result, usages] satisfies EB.AST;
}

/* `P [| \st _ -> live st E |]` */
function* live(identity: EB.Term, payload: NF.Value, result: NF.Value): M.Elaboration<NF.Value> {
	const lvl = (yield* M.reader.ask()).env.length;
	const quoted = (value: NF.Value) => NF.quote(lvl + 2, value);
	const state = EB.Constructors.Var({ type: "Bound", index: 1 });

	const operation = EB.Constructors.App("Explicit", EB.Constructors.Var({ type: "Foreign", name: OP_LIVE }), state);
	const instantiated = EB.Constructors.App("Implicit", EB.Constructors.App("Implicit", operation, yield* quoted(payload)), yield* quoted(result));
	const body = EB.Constructors.App("Explicit", instantiated, yield* quoted(yield* NF.evaluate(identity)));

	return NF.Constructors.Modal(payload, { quantity: Q.Many, liquid: yield* Liquid.Predicate.Lambda(payload, body) });
}

/*
 * The payload and result of an identity's carrier, constraining an unknown carrier to `Effect P R`. A carrier's implicit
 * parameters, as in `(a: Type) => Effect String a`, are instantiated with fresh metas where a capture uses it, and with
 * rigid atoms where a handler is checked against it, so the handler works for every instance.
 */
export function* signature(carrier: NF.Value, rigid = false): M.Elaboration<[NF.Value, NF.Value]> {
	const { value } = yield* NF.view(carrier);
	return yield* match(value)
		.with({ type: "App", func: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Effect" } } } }, function* ({ func, arg }) {
			return [func.arg, arg] satisfies [NF.Value, NF.Value];
		})
		.with({ type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, function* (pi) {
			const lvl = (yield* M.reader.ask()).env.length;
			const argument = rigid
				? NF.Constructors.Atom(`$parameter${yield* M.supply.fresh("skolem")}`)
				: NF.Constructors.Var(yield* EB.freshMeta(lvl, pi.binder.annotation));
			return yield* signature(yield* NF.apply(pi.binder, pi.closure, argument), rigid);
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
