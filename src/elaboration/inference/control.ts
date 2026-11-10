/*
 * Deep handlers capture the identity and user handler once, then reinstall the delimiter around resumptions.
 * Elaborating source expressions in their final generated scopes preserves outer references.
 * https://github.com/tiansivive/z-yap/blob/main/zettels/effect-identities.design.md
 */
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import * as Q from "@yap/shared/modalities/multiplicity";

type With = Extract<Src.Term, { type: "with" }>;
const ImplicitPi = NF.View.Sealed({ type: "Abs", binder: { type: "Pi", icit: "Implicit" } });

export const infer = (node: With): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "With" } }, function* () {
		const answer = yield* fresh();
		const [term, usages] = yield* check(node, answer);
		return [term, answer, usages] satisfies EB.AST;
	});

export function* check(node: With, answer: NF.Value): M.Elaboration<[EB.Term, Q.Usages]> {
	const [clause, ...rest] = node.handlers;
	const lvl = (yield* M.reader.ask()).env.length;
	const carrier = yield* fresh();
	const [identity, type, identityUsages] = yield* within("$identity", carrier, () => EB.infer(clause.identity));
	yield* M.constrain({ type: "assign", left: carrier, right: type, lvl });

	return yield* within("$identity", type, function* (identityScope) {
		const expected = yield* handler(type, answer);
		const [user, userType, userUsages] = yield* within("$user", expected, () =>
			match(clause.handler)
				.with({ type: "lambda" }, { type: "hole" }, function* (source) {
					const [term, usages] = yield* EB.check(source, expected);
					return [term, expected, usages] satisfies EB.AST;
				})
				.otherwise(function* (source) {
					const ast = yield* EB.infer(source);
					const [term, inferred, usages] = yield* match(yield* NF.view(expected))
						.with(ImplicitPi, () => M.of(ast))
						.otherwise(() => EB.Icit.insert(ast));
					yield* M.constrain({ type: "assign", left: inferred, right: expected, lvl: (yield* M.reader.ask()).env.length });
					return [term, expected, usages] satisfies EB.AST;
				}),
		);

		return yield* within("$user", userType, userScope =>
			within("$installed", expected, function* (installedScope) {
				const references = { identity: identityScope.value, user: userScope.value, installed: installedScope.value };
				const installed = yield* wrapper(type, answer, references, []);
				const [first, ...remaining] = rest;
				const [body, bodyUsages] = yield* EB.check(first ? { ...node, handlers: [first, ...remaining] } : node.term, answer);
				const bindings = [
					EB.Constructors.Stmt.Let("$identity", identity, type),
					EB.Constructors.Stmt.Let("$user", user, userType),
					EB.Constructors.Stmt.Let("$installed", installed, expected),
				];
				const term = EB.Constructors.Reset(body, { identity: yield* quote(references.identity), handler: yield* quote(references.installed) });
				return [
					EB.Constructors.Block(bindings, term),
					Q.add(identityUsages.slice(identityScope.depth - lvl), Q.add(userUsages.slice(userScope.depth - lvl), bodyUsages.slice(installedScope.depth - lvl))),
				];
			}),
		);
	});
}

function* handler(carrier: NF.Value, answer: NF.Value): M.Elaboration<NF.Value> {
	return yield* match(yield* NF.view(carrier))
		.with(ImplicitPi, function* ({ value: pi }) {
			const ctx = yield* M.reader.ask();
			const body = yield* M.reader.local(
				c => EB.bind(c, pi.binder, pi.binder.annotation, "inserted"),
				(function* () {
					return yield* handler(yield* NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(ctx.env.length)), answer);
				})(),
			);
			return NF.Constructors.Pi(pi.binder.variable, "Implicit", pi.binder.annotation, yield* NF.closeVal(body));
		})
		.otherwise(function* () {
			const [payload, result] = yield* signature(carrier);
			return yield* arrow(payload, yield* arrow(yield* arrow(result, answer), answer));
		});
}

function* wrapper(
	carrier: NF.Value,
	answer: NF.Value,
	references: { identity: NF.Value; user: NF.Value; installed: NF.Value },
	parameters: NF.Value[],
): M.Elaboration<EB.Term> {
	return yield* match(yield* NF.view(carrier))
		.with(ImplicitPi, ({ value: pi }) =>
			lambda(pi.binder.variable, "Implicit", pi.binder.annotation, function* (parameter) {
				return yield* wrapper(yield* NF.apply(pi.binder, pi.closure, parameter), answer, references, [...parameters, parameter]);
			}),
		)
		.otherwise(function* () {
			const [payload, result] = yield* signature(carrier);
			const continuation = yield* arrow(result, answer);
			return yield* lambda("$payload", "Explicit", payload, p =>
				lambda("$k", "Explicit", continuation, function* (k) {
					const deep = yield* lambda("$value", "Explicit", result, function* (value) {
						return EB.Constructors.Reset(EB.DSL.app(yield* quote(k), yield* quote(value)), {
							identity: yield* quote(references.identity),
							handler: yield* quote(references.installed),
						});
					});
					const args = yield* M.traverse(parameters, quote);
					const user = args.reduce((term, argument) => EB.Constructors.App("Implicit", term, argument), yield* quote(references.user));
					return EB.DSL.app(EB.DSL.app(user, yield* quote(p)), deep);
				}),
			);
		});
}

function* lambda(
	variable: string,
	icit: "Explicit" | "Implicit",
	annotation: NF.Value,
	body: (variable: NF.Value) => M.Elaboration<EB.Term>,
): M.Elaboration<EB.Term> {
	const ctx = yield* M.reader.ask();
	const binding: EB.Binding = { type: "Lambda", variable, icit, annotation: yield* quote(annotation) };
	const term = yield* M.reader.local(c => EB.bind(c, binding, annotation, "inserted"), body(NF.Constructors.Rigid(ctx.env.length)));
	return EB.Constructors.Abs(binding, term);
}

function* within<A>(variable: string, annotation: NF.Value, body: (scope: { value: NF.Value; depth: number }) => M.Elaboration<A>): M.Elaboration<A> {
	const ctx = EB.bind(yield* M.reader.ask(), { type: "Let", variable }, annotation, "inserted");
	return yield* M.reader.local(() => ctx, body({ value: ctx.env[0].nf, depth: ctx.env.length }));
}

function* quote(value: NF.Value): M.Elaboration<EB.Term> {
	return yield* NF.quote((yield* M.reader.ask()).env.length, value);
}

function* fresh(): M.Elaboration<NF.Value> {
	return NF.Constructors.Var(yield* EB.freshMeta((yield* M.reader.ask()).env.length, NF.Type));
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
