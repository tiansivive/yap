import { describe, it, expect, beforeEach } from "vitest";
import * as EB from "@yap/elaboration";

import { translate } from "../translate";
import { display } from "../display";
import { resetId, Nodes, Query, entry } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { eta } from "../passes/eta";

describe("eta-reduce", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
	});

	it("λx. f(x) → f when f is free", () => {
		// λx. free("f")(x)
		const term = EB.DSL.lambda("x", EB.DSL.app(EB.DSL.free("f"), EB.DSL.bound(0)), EB.DSL.free("Int"));
		const before = translate(term);
		const after = eta(before);
		expect(display(after)).toMatchSnapshot();

		expect(Query.byTag(Tags.LAMBDA)(after).size).toBe(0);
		expect(Query.byTag(Tags.APP)(after).size).toBe(0);
		expect(Query.byTag(Tags.VAR_BOUND)(after).size).toBe(0);
		expect(Query.byTag(Tags.VAR_REF)(after).size).toBe(2);
	});

	it("λx. (λy. y)(x) → λy. y", () => {
		// inner = λy. y (identity)
		const inner = EB.DSL.lambda("y", EB.DSL.bound(0), EB.DSL.free("Int"));
		// outer = λx. inner(x) — eta-reducible
		const term = EB.DSL.lambda("x", EB.DSL.app(inner, EB.DSL.bound(0)), EB.DSL.free("Int"));
		const before = translate(term);
		const after = eta(before);
		expect(display(after)).toMatchSnapshot();

		expect(Query.byTag(Tags.LAMBDA)(after).size).toBe(1);
	});

	it("does NOT reduce λx. f(x) when x appears in f", () => {
		// λx. (λy. x)(x) — x is free in the func position (λy. x)
		const func = EB.DSL.lambda("y", EB.DSL.bound(1), EB.DSL.free("Int"));
		const term = EB.DSL.lambda("x", EB.DSL.app(func, EB.DSL.bound(0)), EB.DSL.free("Int"));
		const before = translate(term);
		const after = eta(before);

		expect(Query.byTag(Tags.LAMBDA)(after).size).toBe(2);
	});

	it("does NOT reduce when body is not an app", () => {
		// λx. x — body is var:bound, not app
		const term = EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int"));
		const before = translate(term);
		const after = eta(before);

		expect(Query.byTag(Tags.LAMBDA)(after).size).toBe(1);
	});

	it("reduces nested eta: λx. (λy. f(y))(x) → f", () => {
		// λy. free("f")(y)
		const inner = EB.DSL.lambda("y", EB.DSL.app(EB.DSL.free("f"), EB.DSL.bound(0)), EB.DSL.free("Int"));
		// λx. inner(x)
		const term = EB.DSL.lambda("x", EB.DSL.app(inner, EB.DSL.bound(0)), EB.DSL.free("Int"));
		const before = translate(term);
		const after = eta(before);
		expect(display(after)).toMatchSnapshot();

		expect(Query.byTag(Tags.LAMBDA)(after).size).toBe(0);
	});

	it("λx.λy. f(x)(y) → f (double eta)", () => {
		const body = EB.DSL.app(EB.DSL.app(EB.DSL.free("f"), EB.DSL.bound(1)), EB.DSL.bound(0));
		const inner = EB.DSL.lambda("y", body, EB.DSL.free("Int"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.free("Int"));
		const before = translate(outer);
		const after = eta(before);
		expect(display(after)).toMatchSnapshot();

		expect(Query.byTag(Tags.LAMBDA)(after).size).toBe(0);
		expect(Query.byTag(Tags.APP)(after).size).toBe(0);
		expect(Query.byTag(Tags.VAR_BOUND)(after).size).toBe(0);
	});

	it("double eta preserves correct var:bound indices", () => {
		const body = EB.DSL.app(EB.DSL.app(EB.DSL.free("f"), EB.DSL.bound(1)), EB.DSL.bound(0));
		const inner = EB.DSL.lambda("y", body, EB.DSL.free("Int"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.free("Int"));
		const before = translate(outer);
		const after = eta(before);

		const bounds = Query.byTag(Tags.VAR_BOUND)(after);
		expect(bounds.size).toBe(0);
	});

	it("preserves entry when eta-reducing the entry node", () => {
		const term = EB.DSL.lambda("x", EB.DSL.app(EB.DSL.free("f"), EB.DSL.bound(0)), EB.DSL.free("Int"));
		const before = translate(term);
		const after = eta(before);

		expect(entry(after)).toBeDefined();
	});
});
