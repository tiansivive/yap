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
const callback = (identity: EB.Term) => lambda("x", number, C.Suspend(identity, bound(0), number));
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
		assert(retained.type === "Block", "Expected a handled-result binding");

		expect(retained.statements[0]).toMatchObject({ type: "Let", annotation: { type: "Lit", value: Lit.Atom("String") } });
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
});

describe("elaborated retained calls", () => {
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
