import { beforeEach, describe, expect, it } from "vitest";
import assert from "node:assert";
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { declaration, elaborateModule } from "../../__tests__/module";
import { mkCtx, runNF } from "../../inference/__tests__/util";

const C = EB.Constructors;
const atom = (name: string) => C.Lit(Lit.Atom(name));
const num = (value: number) => C.Lit(Lit.Num(value));
const bound = (index: number) => C.Var(EB.Bound(index));
const number = atom("Num");
const string = atom("String");
const type = atom("Type");
const arrow = (domain: EB.Term, codomain: EB.Term) => C.Pi("x", "Explicit", domain, codomain);
const lambda = (name: string, annotation: EB.Term, body: EB.Term) => C.Lambda(name, "Explicit", body, annotation);
const app = (func: EB.Term, arg: EB.Term) => C.App("Explicit", func, arg);
const call = (func: EB.Term, arg: EB.Term, annotation = number) => C.Ann(app(func, arg), annotation);
const add = (a: EB.Term, b: EB.Term) => app(app(C.Var(C.Vars.Foreign("$add")), a), b);
const install = (identity: EB.Term, handler: EB.Term, term: EB.Term, annotation = number) => C.Ann(C.Reset(term, { identity, handler }), annotation);
const abort = (value: EB.Term, answer = number) => lambda("p", number, lambda("k", arrow(number, answer), value));
const suspend = (identity: EB.Term, payload: EB.Term, meta = 7) => C.Bubble(meta, NF.Constructors.Atom("Num"), [], C.Suspend(identity, payload, number));
const callback = (identity: EB.Term) => lambda("x", number, suspend(identity, bound(0)));
const evaluate = (term: EB.Term) => runNF(mkCtx(), () => NF.evaluate(term));
const quote = (term: EB.Term) => runNF(mkCtx(), () => NF.quote(0, evaluate(term)));
const unann = (term: EB.Term): EB.Term =>
	match(term)
		.with({ type: "Ann" }, ({ term }) => unann(term))
		.otherwise(term => term);

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("retained calls", () => {
	it.each([
		["plain", "with a producer"],
		["plain", "with an abstract binder"],
		["modal", "with a producer"],
		["modal", "with an abstract binder"],
	])("reduces a primitive operation through a %s existential %s", (wrapper, kind) => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow(number, number)));
		const producer = kind === "with a producer" ? runNF(ctx, () => NF.evaluate(app(bound(0), num(5)))) : undefined;
		const value = NF.Constructors.Exists("r", NF.Constructors.Atom("Num"), { ctx, value: NF.Constructors.Lit(Lit.Num(7)) }, producer);
		const argument = wrapper === "modal" ? NF.Constructors.Modal(value, { quantity: "Many", liquid: NF.Constructors.Lit(Lit.Bool(true)) }) : value;
		const increment = evaluate(app(C.Var(C.Vars.Foreign("$add")), num(1)));
		const result = runNF(ctx, () => NF.reduce(increment, argument, "Explicit"));

		expect(result).toMatchObject({ type: "Existential", producer, body: { value: { type: "Lit", value: Lit.Num(8) } } });
	});

	it("applies a function carried by an abstract existential", () => {
		const ctx = mkCtx();
		const value = NF.Constructors.Exists("r", NF.Constructors.Atom("Num"), { ctx, value: evaluate(lambda("x", number, add(bound(0), num(1)))) });

		expect(runNF(ctx, () => NF.reduce(value, NF.Constructors.Lit(Lit.Num(7)), "Explicit"))).toMatchObject({
			type: "Existential",
			producer: undefined,
			body: { value: { type: "Lit", value: Lit.Num(8) } },
		});
	});

	it.each(["bare", "annotated"])("preserves the %s blocked producer while reducing its body", annotation => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow(number, number)));
		const producer = app(bound(0), num(5));
		const argument = annotation === "annotated" ? C.Ann(producer, number) : producer;
		const value = runNF(ctx, () => NF.evaluate(app(lambda("ignored", number, num(7)), argument)));

		expect(value).toMatchObject({
			type: "Existential",
			annotation: { type: "Lit", value: Lit.Atom("Num") },
			producer: { type: "Neutral", kind: "Blocked", value: { type: "App", arg: { value: Lit.Num(5) } } },
			body: { value: { type: "Lit", value: Lit.Num(7) } },
		});
		const residual = unann(runNF(ctx, () => NF.quote(ctx.env.length, value)));
		assert(residual.type === "Block", "Expected the producer binding");
		expect(residual.statements).toHaveLength(1);
		expect(unann(residual.statements[0].value)).toMatchObject({
			type: "App",
			func: { type: "Var", variable: { index: 1 } },
			arg: { type: "Lit", value: Lit.Num(5) },
		});
		expect(residual.return).toMatchObject({ type: "Lit", value: Lit.Num(7) });
	});

	it.each(["bare", "annotated"])("keeps the %s unknown tail call as an ordinary blocked application", annotation => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow(number, number)));
		const producer = app(bound(0), num(5));
		const term = annotation === "annotated" ? C.Ann(producer, number) : producer;
		const value = runNF(ctx, () => NF.evaluate(term));

		expect(value).toMatchObject({ type: "Neutral", kind: "Blocked", value: { type: "App", arg: { value: Lit.Num(5) } } });
	});

	it("keeps a producer through another application that ignores its conditional result", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow(number, number)));
		const first = app(lambda("ignored", number, num(7)), call(bound(0), num(5)));
		const body = app(lambda("ignored", number, num(9)), first);
		const value = runNF(ctx, () => NF.evaluate(body));

		expect(value).toMatchObject({
			type: "Existential",
			producer: { type: "Neutral", value: { type: "App", arg: { value: Lit.Num(5) } } },
			body: { value: { type: "Lit", value: Lit.Num(9) } },
		});
		const residual = quote(lambda("f", arrow(number, number), body));

		expect(evaluate(install(atom("E"), abort(num(99)), app(residual, callback(atom("E")))))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
	});

	it("applies a conditional function while preserving its producer and captured result", () => {
		const returned = app(lambda("result", number, lambda("x", number, bound(1))), call(bound(0), num(5)));
		const program = lambda("f", arrow(number, number), app(returned, num(3)));
		const residual = unann(quote(program));

		assert(residual.type === "Abs", "Expected the function lambda");
		const retained = unann(residual.body);
		assert(retained.type === "Block", "Expected the function producer binding");
		expect(retained.statements).toHaveLength(1);
		expect(retained.return).toMatchObject({ type: "Var", variable: { index: 0 } });
		expect(evaluate(app(residual, lambda("x", number, bound(0))))).toMatchObject({ type: "Lit", value: Lit.Num(5) });
		expect(evaluate(install(atom("E"), abort(num(99)), app(residual, callback(atom("E")))))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
	});

	it("keeps an ignored call within the lambda opened by quotation", () => {
		const body = app(lambda("ignored", number, num(7)), call(bound(1), bound(0)));
		const program = lambda("f", arrow(number, number), lambda("x", number, body));
		const residual = unann(quote(program));

		assert(residual.type === "Abs", "Expected the outer lambda");
		const inner = unann(residual.body);
		assert(inner.type === "Abs", "Expected the inner lambda");
		const retained = unann(inner.body);
		expect(retained).toMatchObject({ type: "Block", return: { type: "Lit", value: Lit.Num(7) } });
		assert(retained.type === "Block", "Expected a retained call binding");
		expect(retained.statements).toHaveLength(1);
		expect(unann(retained.statements[0].value)).toMatchObject({
			type: "App",
			func: { type: "Var", variable: { index: 2 } },
			arg: { type: "Var", variable: { index: 1 } },
		});
		expect(evaluate(install(atom("E"), abort(num(99)), app(app(residual, callback(atom("E"))), num(5))))).toMatchObject({
			type: "Lit",
			value: Lit.Num(99),
		});
	});

	it.each(["argument", "argument and producer"])("preserves the %s in nested lambdas after removing unused let bindings", result => {
		const value = result === "argument" ? bound(0) : add(bound(0), bound(2));
		const body = app(lambda("result", number, lambda("x", number, lambda("y", number, value))), call(bound(2), num(5)));
		const statements = [C.Stmt.Let("a", num(1), NF.Constructors.Atom("Num")), C.Stmt.Let("b", num(2), NF.Constructors.Atom("Num"))];
		const program = lambda("f", arrow(number, number), C.Block(statements, body));
		const applied = (term: EB.Term) => app(app(app(term, lambda("n", number, bound(0))), num(10)), num(20));
		const expected = Lit.Num(result === "argument" ? 20 : 25);

		expect(evaluate(applied(program))).toMatchObject({ type: "Lit", value: expected });
		expect(evaluate(applied(quote(program)))).toMatchObject({ type: "Lit", value: expected });
	});

	it("binds one call result shared by the domain and codomain of a Pi", () => {
		const shared = app(lambda("A", type, C.Pi("x", "Explicit", bound(0), bound(1))), call(bound(0), num(0), type));
		const residual = unann(quote(lambda("f", arrow(number, type), shared)));

		assert(residual.type === "Abs", "Expected a lambda");
		const retained = unann(residual.body);
		assert(retained.type === "Block", "Expected a shared call binding");
		expect(retained.statements).toHaveLength(1);
		expect(unann(retained.statements[0].value)).toMatchObject({ type: "App", arg: { value: Lit.Num(0) } });
		expect(retained.return).toMatchObject({
			type: "Abs",
			binding: { type: "Pi", annotation: { type: "Var", variable: { index: 0 } } },
			body: { type: "Var", variable: { index: 1 } },
		});
	});

	it("keeps a dependent call annotation within its own evaluation entry", () => {
		const signature = C.Pi("x", "Explicit", number, call(bound(1), bound(0), type));
		const result = call(bound(0), num(5), call(bound(1), num(5), type));
		const program = lambda("T", arrow(number, type), lambda("f", signature, result));
		const family = lambda("x", number, number);
		const identity = lambda("x", number, bound(0));
		expect(evaluate(app(app(program, family), identity))).toMatchObject({ type: "Lit", value: Lit.Num(5) });
		const residual = unann(quote(program));

		assert(residual.type === "Abs", "Expected the family lambda");
		expect(unann(residual.body)).toMatchObject({ type: "Abs", binding: { type: "Lambda" } });
		expect(evaluate(app(app(residual, family), identity))).toMatchObject({ type: "Lit", value: Lit.Num(5) });
	});

	it("uses the handler's String answer in the computation outside its reset", () => {
		const handled = install(atom("E"), abort(C.Lit(Lit.String("handled")), string), call(bound(0), num(5)), string);
		const program = lambda("f", arrow(number, number), C.Match(handled, [C.Alternative(C.Patterns.Lit(Lit.String("handled")), num(100), [])]));
		expect(evaluate(app(program, callback(atom("E"))))).toMatchObject({ type: "Lit", value: Lit.Num(100) });
		const residual = unann(quote(program));
		assert(residual.type === "Abs", "Expected a lambda");
		const retained = unann(residual.body);
		assert(retained.type === "Match", "Expected a match on the handled result");

		expect(unann(retained.scrutinee)).toMatchObject({ type: "Reset" });
		expect(evaluate(app(residual, callback(atom("E"))))).toMatchObject({ type: "Lit", value: Lit.Num(100) });
	});

	it("preserves each nested handler and the work outside each reset", () => {
		const inner = install(atom("B"), abort(num(20)), call(bound(0), num(5)));
		const outer = install(atom("A"), abort(num(99)), add(inner, num(1)));
		const program = lambda("f", arrow(number, number), add(outer, num(1000)));
		expect(evaluate(app(program, callback(atom("B"))))).toMatchObject({ type: "Lit", value: Lit.Num(1021) });
		expect(evaluate(app(program, callback(atom("A"))))).toMatchObject({ type: "Lit", value: Lit.Num(1099) });
		const residual = quote(program);

		expect(evaluate(app(residual, callback(atom("B"))))).toMatchObject({ type: "Lit", value: Lit.Num(1021) });
		expect(evaluate(app(residual, callback(atom("A"))))).toMatchObject({ type: "Lit", value: Lit.Num(1099) });
	});

	it.each(["bare", "annotated", "bound"])("preserves a %s reset around a callback through quotation", form => {
		const handled = (index: number) => C.Reset(call(bound(index), num(5)), { identity: atom("E"), handler: abort(num(99)) });
		const body = match(form)
			.with("bare", () => handled(0))
			.with("annotated", () => C.Ann(handled(0), number))
			.otherwise(() => C.Block([C.Stmt.Let("handled", handled(1), NF.Constructors.Atom("Num"))], C.Ann(bound(0), number)));
		const program = lambda("f", arrow(number, number), body);

		expect(evaluate(app(program, callback(atom("E"))))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
		expect(evaluate(app(quote(program), callback(atom("E"))))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
	});

	it("quotes a captured delimiter while sharing its suspension result and preserving outside work", () => {
		const resume = (increment: number) => lambda("p", number, lambda("k", arrow(number, number), app(bound(0), add(bound(1), num(increment)))));
		const shared = app(lambda("r", number, add(add(bound(0), bound(0)), suspend(atom("B"), num(2), 8))), suspend(atom("A"), num(1)));
		const program = add(C.Reset(shared, { identity: atom("B"), handler: resume(10) }), num(100));
		const residual = quote(program);

		expect(evaluate(install(atom("A"), resume(1), program))).toMatchObject({ type: "Lit", value: Lit.Num(116) });
		expect(evaluate(install(atom("A"), resume(1), residual))).toMatchObject({ type: "Lit", value: Lit.Num(116) });
	});

	it.each(["let", "lambda"])("shares a captured reset result through a %s binder", binder => {
		const resume = lambda("p", number, lambda("k", arrow(number, number), app(bound(0), bound(1))));
		const inner = C.Reset(suspend(atom("A"), num(1)), { identity: atom("B"), handler: resume });
		const body = add(bound(0), bound(0));
		const program =
			binder === "let" ? C.Block([C.Stmt.Let("r", inner, NF.Constructors.Atom("Num"))], body) : app(lambda("r", number, body), inner);

		expect(evaluate(install(atom("A"), resume, program))).toMatchObject({ type: "Lit", value: Lit.Num(2) });
		expect(evaluate(install(atom("A"), resume, quote(program)))).toMatchObject({ type: "Lit", value: Lit.Num(2) });
	});

	it("keeps a symbolic operation under the delimiter its identity later matches", () => {
		const body = app(lambda("r", number, add(bound(0), bound(0))), suspend(bound(0), num(1)));
		const program = lambda("e", app(app(atom("Effect"), number), number), C.Reset(body, { identity: atom("B"), handler: abort(num(99)) }));

		expect(evaluate(app(program, atom("B")))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
		expect(evaluate(app(quote(program), atom("B")))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
	});

	it("keeps the producer before a later suspension under an aborting handler", () => {
		const handler = lambda("p", number, lambda("k", arrow(number, number), bound(1)));
		const body = app(lambda("ignored", number, suspend(atom("E"), num(2))), call(bound(0), num(5)));
		const program = lambda("f", arrow(number, number), install(atom("E"), handler, body));
		const first = lambda("x", number, suspend(atom("E"), num(1), 8));
		const identity = lambda("x", number, bound(0));

		expect(evaluate(app(program, first))).toMatchObject({ type: "Lit", value: Lit.Num(1) });
		expect(evaluate(app(program, identity))).toMatchObject({ type: "Lit", value: Lit.Num(2) });
		const residual = quote(program);

		expect(evaluate(app(residual, first))).toMatchObject({ type: "Lit", value: Lit.Num(1) });
		expect(evaluate(app(residual, identity))).toMatchObject({ type: "Lit", value: Lit.Num(2) });
	});

	it("preserves the order of producers accumulated through nested applications", () => {
		const handler = lambda("p", number, lambda("k", arrow(number, number), bound(1)));
		const first = app(lambda("a", number, lambda("b", number, num(7))), call(bound(1), num(5)));
		const body = app(first, call(bound(0), num(6)));
		const program = lambda("f", arrow(number, number), lambda("g", arrow(number, number), install(atom("E"), handler, body)));
		const one = lambda("x", number, suspend(atom("E"), num(1)));
		const two = lambda("x", number, suspend(atom("E"), num(2), 8));
		const identity = lambda("x", number, bound(0));
		const residual = quote(program);

		expect(evaluate(app(app(residual, one), two))).toMatchObject({ type: "Lit", value: Lit.Num(1) });
		expect(evaluate(app(app(residual, identity), two))).toMatchObject({ type: "Lit", value: Lit.Num(2) });
		expect(evaluate(app(app(residual, identity), identity))).toMatchObject({ type: "Lit", value: Lit.Num(7) });
	});

	it("preserves an anonymous reset around the producer and a later suspension", () => {
		const continuation = arrow(number, number);
		const handler = C.Lambda("r", "Implicit", lambda("p", arrow(continuation, number), lambda("k", continuation, app(bound(1), bound(0)))), type);
		const later = suspend(EB.Anonymous, lambda("k", continuation, num(2)));
		const body = app(lambda("ignored", number, later), call(bound(0), num(5)));
		const program = lambda("f", arrow(number, number), install(EB.Anonymous, handler, body));
		const first = lambda("x", number, suspend(EB.Anonymous, lambda("k", continuation, num(1)), 8));
		const identity = lambda("x", number, bound(0));

		expect(evaluate(app(program, first))).toMatchObject({ type: "Lit", value: Lit.Num(1) });
		expect(evaluate(app(program, identity))).toMatchObject({ type: "Lit", value: Lit.Num(2) });
		const residual = quote(program);

		expect(evaluate(app(residual, first))).toMatchObject({ type: "Lit", value: Lit.Num(1) });
		expect(evaluate(app(residual, identity))).toMatchObject({ type: "Lit", value: Lit.Num(2) });
	});

	it("keeps a handler-returned unknown call under its outer delimiter", () => {
		const dispatch = C.Match(bound(1), [
			C.Alternative(C.Patterns.Lit(Lit.Num(1)), call(bound(2), num(5)), []),
			C.Alternative(C.Patterns.Wildcard(), num(77), []),
		]);
		const handler = lambda("p", number, lambda("k", arrow(number, number), dispatch));
		const inner = install(atom("E"), handler, suspend(atom("E"), num(1)));
		const program = lambda("f", arrow(number, number), install(atom("E"), abort(num(99)), inner));
		const later = lambda("x", number, suspend(atom("E"), num(2), 8));

		expect(evaluate(app(program, later))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
		expect(evaluate(app(quote(program), later))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
	});

	it("preserves outer handling for an unknown call reached through a bare continuation", () => {
		const dispatch = C.Match(bound(1), [
			C.Alternative(C.Patterns.Lit(Lit.Num(1)), call(bound(0), bound(1)), []),
			C.Alternative(C.Patterns.Wildcard(), num(77), []),
		]);
		const handler = lambda("p", number, lambda("k", arrow(number, number), dispatch));
		const body = app(lambda("ignored", number, call(bound(1), num(5))), suspend(atom("E"), num(1)));
		const program = lambda("f", arrow(number, number), install(atom("E"), abort(num(99)), install(atom("E"), handler, body)));
		const later = lambda("x", number, suspend(atom("E"), num(2), 8));

		expect(evaluate(app(program, later))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
		expect(evaluate(app(quote(program), later))).toMatchObject({ type: "Lit", value: Lit.Num(99) });
	});
});

describe("elaborated retained calls", () => {
	it("preserves an elaborated suspension's result symbol through evaluation and quotation", () => {
		const module = elaborateModule("foreign E: Effect Num Num; let callback: Num -> Num = \\x -> suspend @E x;");
		expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
		const callback = declaration(module, "callback")?.elaborated;
		assert(callback, "Expected the callback declaration");
		const term = unann(callback.tm);
		assert(term.type === "Abs", "Expected the callback lambda");
		const operation = unann(term.body);
		assert(operation.type === "Bubble", "Expected the suspension's result binding");
		expect(operation.meta).toEqual(expect.any(Number));
		expect(operation.shift).toMatchObject({ type: "Suspend" });
		const value = runNF(callback.ctx, () => NF.evaluate(app(callback.tm, num(5))), callback.registry);
		expect(value).toMatchObject({ type: "Neutral", kind: "Blocked", value: { type: "Bubble", meta: operation.meta } });
		const residual = runNF(callback.ctx, () => NF.quote(callback.ctx.env.length, value), callback.registry);

		expect(residual).toMatchObject({ type: "Bubble", meta: operation.meta, shift: { type: "Suspend", payload: { value: Lit.Num(5) } } });
	});

	it("executes a callback under its source handler after quoting the open function", () => {
		const module = elaborateModule(`
			foreign E: Effect Num Num;
			let callback: Num -> Num = \\x -> suspend @E x;
			let result: (Num -> Num) -> Num = \\f -> with E: (\\p k -> 99) in f 5;
		`);
		expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
		const program = declaration(module, "result")?.elaborated;
		const argument = declaration(module, "callback")?.elaborated;
		if (!program || !argument) {
			throw new Error("Expected the program and callback declarations");
		}
		const closed = runNF(program.ctx, () => NF.evaluate(app(program.tm, argument.tm)), program.registry);
		expect(closed).toMatchObject({ type: "Lit", value: Lit.Num(99) });
		const residual = runNF(
			program.ctx,
			function* () {
				return yield* NF.quote(program.ctx.env.length, yield* NF.evaluate(program.tm));
			},
			program.registry,
		);

		expect(runNF(program.ctx, () => NF.evaluate(app(residual, argument.tm)), program.registry)).toMatchObject({ type: "Lit", value: Lit.Num(99) });
	});
});
