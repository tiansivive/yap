/*
 * Deep handlers capture the identity and user handler once, then reinstall the delimiter around resumptions.
 * Elaborating source expressions in their final generated scopes preserves outer references.
 * https://github.com/tiansivive/z-yap/blob/main/zettels/effect-identities.design.md
 */
import { isMatching, match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import * as Q from "@yap/shared/modalities/multiplicity";

type With = Extract<Src.Term, { type: "with" }>;

export const infer = (node: With): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "With" } }, function* () {
		const ctx = yield* M.reader.ask();
		const answer = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
		const [term, usages] = yield* check(node, answer);
		return [term, answer, usages] satisfies EB.AST;
	});

export function* check(node: With, answer: NF.Value): M.Elaboration<[EB.Term, Q.Usages]> {
	const [clause] = node.handlers;
	const ctx = yield* M.reader.ask();
	const lvl = ctx.env.length;
	const carrier = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
	const [identity, type, identityUsages] = yield* M.reader.local(
		c => EB.bind(c, { type: "Let", variable: "$identity" }, carrier, "inserted"),
		EB.infer(clause.identity),
	);
	yield* M.constrain({ type: "assign", left: carrier, right: type, lvl });
	return yield* install(node, answer, [identity, type, identityUsages]);
}

function* install(node: With, answer: NF.Value, [identity, type, identityUsages]: EB.AST): M.Elaboration<[EB.Term, Q.Usages]> {
	const [clause, ...rest] = node.handlers;
	const ctx = yield* M.reader.ask();
	const lvl = ctx.env.length;
	const identityScope = EB.bind(ctx, { type: "Let", variable: "$identity" }, type, "inserted");
	const expected = yield* M.reader.local(() => identityScope, handler(type, answer));
	const userScope = EB.bind(identityScope, { type: "Let", variable: "$user" }, expected, "inserted");
	const [user, userUsages] = yield* M.reader.local(
		() => userScope,
		match(clause.handler)
			.with({ type: "lambda" }, { type: "hole" }, source => EB.check(source, expected))
			.otherwise(function* (source) {
				const ast = yield* EB.infer(source);
				const [term, inferred, usages] = isMatching(NF.View.Sealed(NF.Patterns.ImplicitPi), yield* NF.view(expected)) ? ast : yield* EB.Icit.insert(ast);
				yield* M.constrain({ type: "assign", left: inferred, right: expected, lvl: userScope.env.length });
				return [term, usages] satisfies [EB.Term, Q.Usages];
			}),
	);

	const installedScope = EB.bind(userScope, { type: "Let", variable: "$installed" }, expected, "inserted");
	const references = { identity: identityScope.env[0].nf, user: userScope.env[0].nf, installed: installedScope.env[0].nf };
	const installed = yield* M.reader.local(() => installedScope, deep(type, answer, references, []));
	const [first, ...remaining] = rest;
	const [body, bodyUsages] = yield* M.reader.local(() => installedScope, EB.check(first ? { ...node, handlers: [first, ...remaining] } : node.term, answer));
	const bindings = [
		EB.Constructors.Stmt.Let("$identity", identity, type),
		EB.Constructors.Stmt.Let("$user", user, expected),
		EB.Constructors.Stmt.Let("$installed", installed, expected),
	];
	const term = EB.Constructors.Reset(body, {
		identity: yield* NF.quote(installedScope.env.length, references.identity),
		handler: yield* NF.quote(installedScope.env.length, references.installed),
	});
	return [
		EB.Constructors.Block(bindings, term),
		Q.add(
			identityUsages.slice(identityScope.env.length - lvl),
			Q.add(userUsages.slice(userScope.env.length - lvl), bodyUsages.slice(installedScope.env.length - lvl)),
		),
	];
}

function* handler(carrier: NF.Value, answer: NF.Value): M.Elaboration<NF.Value> {
	const viewed = yield* NF.view(carrier);
	if (isMatching(NF.View.Sealed(NF.Patterns.ImplicitPi), viewed)) {
		const { value: pi } = viewed;
		const ctx = yield* M.reader.ask();
		const scope = EB.bind(ctx, pi.binder, pi.binder.annotation, "inserted");
		const body = yield* M.reader.local(
			() => scope,
			(function* () {
				return yield* handler(yield* NF.apply(pi.binder, pi.closure, scope.env[0].nf), answer);
			})(),
		);
		return NF.Constructors.Pi(pi.binder.variable, "Implicit", pi.binder.annotation, yield* NF.closeVal(body));
	}
	const [payload, result] = yield* signature(carrier);
	return yield* arrow(payload, yield* arrow(yield* arrow(result, answer), answer));
}

function* deep(
	carrier: NF.Value,
	answer: NF.Value,
	references: { identity: NF.Value; user: NF.Value; installed: NF.Value },
	parameters: NF.Value[],
): M.Elaboration<EB.Term> {
	const ctx = yield* M.reader.ask();
	const viewed = yield* NF.view(carrier);
	if (isMatching(NF.View.Sealed(NF.Patterns.ImplicitPi), viewed)) {
		const { value: pi } = viewed;
		const scope = EB.bind(ctx, { type: "Lambda", variable: pi.binder.variable }, pi.binder.annotation, "inserted");
		const parameter = scope.env[0].nf;
		const body = yield* M.reader.local(
			() => scope,
			(function* () {
				return yield* deep(yield* NF.apply(pi.binder, pi.closure, parameter), answer, references, [...parameters, parameter]);
			})(),
		);
		return EB.Constructors.Lambda(pi.binder.variable, "Implicit", body, yield* NF.quote(ctx.env.length, pi.binder.annotation));
	}

	const [payload, result] = yield* signature(carrier);
	const continuation = yield* arrow(result, answer);
	const payloadScope = EB.bind(ctx, { type: "Lambda", variable: "$payload" }, payload, "inserted");
	const continuationScope = EB.bind(payloadScope, { type: "Lambda", variable: "$k" }, continuation, "inserted");
	const valueScope = EB.bind(continuationScope, { type: "Lambda", variable: "$value" }, result, "inserted");
	const resumed = EB.Constructors.Reset(
		EB.DSL.app(yield* NF.quote(valueScope.env.length, continuationScope.env[0].nf), yield* NF.quote(valueScope.env.length, valueScope.env[0].nf)),
		{ identity: yield* NF.quote(valueScope.env.length, references.identity), handler: yield* NF.quote(valueScope.env.length, references.installed) },
	);
	const resumption = EB.Constructors.Lambda("$value", "Explicit", resumed, yield* NF.quote(continuationScope.env.length, result));
	const args = yield* M.traverse(parameters, parameter => NF.quote(continuationScope.env.length, parameter));
	const user = args.reduce((term, argument) => EB.Constructors.App("Implicit", term, argument), yield* NF.quote(continuationScope.env.length, references.user));
	const applied = EB.DSL.app(EB.DSL.app(user, yield* NF.quote(continuationScope.env.length, payloadScope.env[0].nf)), resumption);
	const body = EB.Constructors.Lambda("$k", "Explicit", applied, yield* NF.quote(payloadScope.env.length, continuation));
	return EB.Constructors.Lambda("$payload", "Explicit", body, yield* NF.quote(ctx.env.length, payload));
}

function* arrow(from: NF.Value, to: NF.Value): M.Elaboration<NF.Value> {
	return NF.Constructors.Pi("x", "Explicit", from, yield* NF.closeVal(to));
}

export const capture = (node: Extract<Src.Term, { type: "capture" }>): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Capture" } }, function* () {
		const [identity, carrier, identityUsages] = yield* EB.Icit.insert(yield* EB.infer(node.identity));
		const [payload, result] = yield* signature(carrier);
		const [value, usages] = yield* EB.check(node.term, payload);
		const annotation = yield* NF.quote((yield* M.reader.ask()).env.length, result);

		return [EB.Constructors.Capture(identity, value, annotation), result, Q.add(identityUsages, usages)] satisfies EB.AST;
	});

function* signature(carrier: NF.Value): M.Elaboration<[NF.Value, NF.Value]> {
	const { value } = yield* NF.view(carrier);
	return yield* match(value)
		.with(NF.Patterns.Effect, function* ({ func, arg }) {
			return [func.arg, arg] satisfies [NF.Value, NF.Value];
		})
		.otherwise(function* () {
			const lvl = (yield* M.reader.ask()).env.length;
			const payload = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
			const result = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
			const effect = NF.Constructors.App(NF.Constructors.App(NF.Constructors.Atom("Effect"), payload, "Explicit"), result, "Explicit");
			yield* M.constrain({ type: "assign", left: carrier, right: effect, lvl });
			return [payload, result] satisfies [NF.Value, NF.Value];
		});
}
