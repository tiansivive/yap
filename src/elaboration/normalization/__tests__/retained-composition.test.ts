import { beforeEach, describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { mkCtx, runNF } from "../../inference/__tests__/util";

const C = EB.Constructors;
const number = C.Lit(Lit.Atom("Num"));
const arrow = C.Pi("x", "Explicit", number, number);
const num = (value: number) => C.Lit(Lit.Num(value));
const bound = (index: number) => C.Var(EB.Bound(index));
const lambda = (name: string, body: EB.Term, annotation = number) => C.Lambda(name, "Explicit", body, annotation);
const app = (func: EB.Term, arg: EB.Term) => C.App("Explicit", func, arg);
const call = (func: EB.Term, arg: EB.Term) => C.Ann(app(func, arg), number);
const add = (left: EB.Term, right: EB.Term) => app(app(C.Var(C.Vars.Foreign("$add")), left), right);
const subtract = (left: EB.Term, right: EB.Term) => app(app(C.Var(C.Vars.Foreign("$sub")), left), right);
const increment = (amount: number) => lambda("n", add(bound(0), num(amount)));
const evaluate = (term: EB.Term) => runNF(mkCtx(), () => NF.evaluate(term));
const quote = (term: EB.Term) => runNF(mkCtx(), () => NF.quote(0, evaluate(term)));

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("retained call composition", () => {
	it("preserves sibling producer order and their shared outer argument", () => {
		const first = app(lambda("x", bound(0)), call(bound(1), bound(2)));
		const second = app(lambda("y", bound(0)), call(bound(0), add(bound(2), num(1))));
		const program = lambda("offset", lambda("f", lambda("g", subtract(first, second), arrow), arrow));
		const apply = (term: EB.Term) => app(app(app(term, num(100)), increment(10)), increment(20));

		expect(evaluate(apply(program))).toMatchObject({ type: "Lit", value: Lit.Num(-11) });
		expect(evaluate(apply(quote(program)))).toMatchObject({ type: "Lit", value: Lit.Num(-11) });
	});

	it("composes producer values evaluated independently in the same context", () => {
		const functionType = evaluate(arrow);
		const ctx = EB.bind(EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, functionType), { type: "Lambda", variable: "g" }, functionType);
		const first = app(lambda("x", lambda("y", subtract(bound(1), bound(0)))), call(bound(1), num(5)));
		const second = app(lambda("y", bound(0)), call(bound(0), num(6)));
		const left = runNF(ctx, () => NF.evaluate(first));
		const right = runNF(ctx, () => NF.evaluate(second));
		const value = runNF(ctx, () => NF.reduce(left, right, "Explicit"));
		const residual = runNF(ctx, () => NF.quote(2, value));
		const close = (body: EB.Term) => app(app(lambda("f", lambda("g", body, arrow), arrow), increment(10)), increment(20));

		expect(evaluate(close(app(first, second)))).toMatchObject({ type: "Lit", value: Lit.Num(-11) });
		expect(evaluate(close(residual))).toMatchObject({ type: "Lit", value: Lit.Num(-11) });
	});

	it("quotes a returned closure with two producer results, an outer value and a fresh parameter", () => {
		const body = add(subtract(bound(2), bound(1)), add(bound(5), bound(0)));
		const first = app(lambda("x", lambda("y", lambda("z", body))), call(bound(1), num(5)));
		const second = app(lambda("y", bound(0)), call(bound(0), num(6)));
		const program = lambda("offset", lambda("f", lambda("g", app(first, second), arrow), arrow));
		const apply = (term: EB.Term) => app(app(app(app(term, num(1000)), increment(10)), increment(20)), num(100));

		expect(evaluate(apply(program))).toMatchObject({ type: "Lit", value: Lit.Num(1089) });
		expect(evaluate(apply(quote(program)))).toMatchObject({ type: "Lit", value: Lit.Num(1089) });
	});

	it("weakens a returned closure through an additional quotation binder", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const body = add(bound(1), add(bound(0), call(bound(2), num(1))));
		const source = app(lambda("result", lambda("x", body)), call(bound(0), num(5)));
		const value = runNF(ctx, () => NF.evaluate(source));
		const residual = runNF(ctx, () => NF.quote(2, value));
		const original = lambda("f", source, arrow);
		const weakened = lambda("f", lambda("extra", residual), arrow);

		expect(evaluate(app(app(original, increment(10)), num(20)))).toMatchObject({ type: "Lit", value: Lit.Num(46) });
		expect(evaluate(app(app(app(weakened, increment(10)), num(100)), num(20)))).toMatchObject({ type: "Lit", value: Lit.Num(46) });
	});

	it("eagerly reduces the conditional body through applications and arithmetic", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, evaluate(arrow));
		const body = app(lambda("n", add(bound(0), num(2))), num(5));
		const source = app(lambda("result", body), call(bound(0), num(9)));
		const value = runNF(ctx, () => NF.evaluate(source));

		expect(value).toMatchObject({
			type: "Existential",
			producer: { type: "Neutral", kind: "Blocked" },
			body: { value: { type: "Lit", value: Lit.Num(7) } },
		});
		const program = lambda("f", source, arrow);
		expect(evaluate(app(program, increment(10)))).toMatchObject({ type: "Lit", value: Lit.Num(7) });
		expect(evaluate(app(quote(program), increment(10)))).toMatchObject({ type: "Lit", value: Lit.Num(7) });
	});
});
