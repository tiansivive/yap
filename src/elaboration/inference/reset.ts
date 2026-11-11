/*
 * Anonymous resets handle the shared unnamed effect with their own answer types.
 * The application handler passes the bare continuation to each capture's payload.
 * https://github.com/tiansivive/z-yap/blob/main/zettels/effect-identities.design.md#raw-delimiters
 */
import { isMatching } from "ts-pattern";
import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import * as Q from "@yap/shared/modalities/multiplicity";
import { update } from "@yap/utils";

type Reset = Extract<Src.Term, { type: "reset" }>;

export const infer = (node: Reset): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Reset" } }, function* () {
		const ctx = yield* M.reader.ask();
		const final = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
		const [term, usages] = yield* check(node, final);
		return [term, final, usages] satisfies EB.AST;
	});

export function* check(node: Reset, final: NF.Value): M.Elaboration<[EB.Term, Q.Usages]> {
	const ctx = yield* M.reader.ask();
	if (node.identity) {
		const expected = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
		const [identity, effectType, identityUsages] = yield* M.reader.local(
			c => EB.bind(c, { type: "Let", variable: "$identity" }, expected, "inserted"),
			EB.infer(node.identity),
		);
		yield* M.constrain({ type: "assign", left: expected, right: effectType, lvl: ctx.env.length });
		const scope = EB.bind(ctx, { type: "Let", variable: "$identity" }, effectType, "inserted");
		const handler = yield* M.reader.local(() => scope, application(effectType, final, final));
		const [body, usages] = yield* M.reader.local(() => scope, EB.check(node.term, final));
		return [
			EB.Constructors.Block(
				[EB.Constructors.Stmt.Let("$identity", identity, effectType)],
				EB.Constructors.Reset(body, {
					identity: yield* NF.quote(scope.env.length, scope.env[0].nf),
					handler,
				}),
			),
			Q.add(identityUsages, usages).slice(scope.env.length - ctx.env.length),
		];
	}
	const initial = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
	const type = yield* effectType(initial, final);
	const delimiter: M.Delimitation = { answer: { initial, final }, capturesOnEveryPath: false };
	yield* M.st.modify(update("delimitations", ds => [delimiter, ...ds]));
	const [body, usages] = yield* EB.check(node.term, initial);
	const {
		delimitations: [{ capturesOnEveryPath }],
	} = yield* M.st.get();
	if (!capturesOnEveryPath) {
		yield* M.constrain({ type: "assign", left: initial, right: final, lvl: ctx.env.length });
	}
	yield* M.st.modify(update("delimitations", ([_d, ...ds]) => ds));
	const handler = yield* application(type, initial, final);
	const identity = EB.Constructors.Ann(EB.Anonymous, yield* NF.quote(ctx.env.length, type));
	return [EB.Constructors.Reset(body, { identity, handler }), usages];
}

function* effectType(initial: NF.Value, final: NF.Value): M.Elaboration<NF.Value> {
	const ctx = yield* M.reader.ask();
	const scope = EB.bind(ctx, { type: "Pi", variable: "r" }, NF.Type, "inserted");
	const body = yield* M.reader.local(
		() => scope,
		(function* () {
			const result = scope.env[0].nf;
			const payload = yield* arrow(yield* arrow(result, initial), final);
			return NF.Constructors.App(NF.Constructors.App(NF.Constructors.Atom("Effect"), payload, "Explicit"), result, "Explicit");
		})(),
	);
	return NF.Constructors.Pi("r", "Implicit", NF.Type, yield* NF.closeVal(body));
}

function* application(effectType: NF.Value, initial: NF.Value, final: NF.Value): M.Elaboration<EB.Term> {
	const ctx = yield* M.reader.ask();
	const viewed = yield* NF.view(effectType);
	if (isMatching(NF.View.Sealed(NF.Patterns.ImplicitPi), viewed)) {
		const { value: pi } = viewed;
		const scope = EB.bind(ctx, { type: "Lambda", variable: pi.binder.variable }, pi.binder.annotation, "inserted");
		const body = yield* M.reader.local(
			() => scope,
			(function* () {
				return yield* application(yield* NF.apply(pi.binder, pi.closure, scope.env[0].nf), initial, final);
			})(),
		);
		return EB.Constructors.Lambda(pi.binder.variable, "Implicit", body, yield* NF.quote(ctx.env.length, pi.binder.annotation));
	}
	const [payload, result] = yield* EB.Control.signature(effectType);
	const continuation = yield* arrow(result, initial);
	yield* M.constrain({ type: "assign", left: payload, right: yield* arrow(continuation, final), lvl: ctx.env.length });
	const payloadScope = EB.bind(ctx, { type: "Lambda", variable: "$payload" }, payload, "inserted");
	const continuationScope = EB.bind(payloadScope, { type: "Lambda", variable: "$k" }, continuation, "inserted");
	const applied = EB.DSL.app(
		yield* NF.quote(continuationScope.env.length, payloadScope.env[0].nf),
		yield* NF.quote(continuationScope.env.length, continuationScope.env[0].nf),
	);
	const body = EB.Constructors.Lambda("$k", "Explicit", applied, yield* NF.quote(payloadScope.env.length, continuation));
	return EB.Constructors.Lambda("$payload", "Explicit", body, yield* NF.quote(ctx.env.length, payload));
}

function* arrow(from: NF.Value, to: NF.Value): M.Elaboration<NF.Value> {
	return NF.Constructors.Pi("x", "Explicit", from, yield* NF.closeVal(to));
}
