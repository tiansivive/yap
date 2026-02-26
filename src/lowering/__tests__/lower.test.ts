import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";

import { lower, lowerToMir } from "../lower";
import { mkCtx } from "../context";
import * as Pretty from "../pretty";

describe("Lowering: primitives and ops", () => {
	it("lowers Lit(Num(42))", () => {
		const fn = lowerToMir(EB.DSL.num(42));
		expect(Pretty.display(fn)).toMatchSnapshot();
	});

	it("lowers Var(Bound 0) with env", () => {
		const term = EB.DSL.bound(0);
		const ctx = mkCtx({ bound: [[0, "x"]] });
		const { instrs, value } = lower(term, ctx);
		expect(instrs).toHaveLength(0);
		expect(value).toBe("x");
	});

	it("lowers Var(Free n) with env", () => {
		const term = EB.DSL.free("foo");
		const ctx = mkCtx({ free: [["foo", "x"]] });
		const { instrs, value } = lower(term, ctx);
		expect(instrs).toHaveLength(0);
		expect(value).toBe("x");
	});

	it("lowers add(1, 2)", () => {
		const fn = lowerToMir(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)));
		expect(Pretty.display(fn)).toMatchSnapshot();
	});

	it("lowers not(true)", () => {
		const fn = lowerToMir(EB.DSL.not(EB.DSL.bool(true)));
		expect(Pretty.display(fn)).toMatchSnapshot();
	});

	it("throws for Lambda (not yet implemented)", () => {
		const term = EB.DSL.lambda("x", EB.DSL.num(1), EB.DSL.type("Num"));
		expect(() => lowerToMir(term)).toThrow(/primitives and ops only/);
	});

	it("throws for Var(Foreign) used as value", () => {
		const term = EB.DSL.foreign("$add");
		const ctx = mkCtx();
		expect(() => lower(term, ctx)).toThrow(/Primitive.*used as value/);
	});
});

describe("Lowering: struct, proj, inj", () => {
	it("lowers struct({ x: 1, y: 2 })", () => {
		const term = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		const fn = lowerToMir(term);
		expect(Pretty.display(fn)).toMatchSnapshot();
	});

	it("lowers proj(label, struct)", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		const fn = lowerToMir(term);
		expect(Pretty.display(fn)).toMatchSnapshot();
	});

	it("lowers inj(label, value, struct)", () => {
		const base = EB.DSL.struct([{ label: "x", value: EB.DSL.num(1) }]);
		const term = EB.DSL.inj("y", EB.DSL.num(2), base);
		const fn = lowerToMir(term);
		expect(Pretty.display(fn)).toMatchSnapshot();
	});

	it("lowers empty struct", () => {
		const term = EB.DSL.struct([]);
		const fn = lowerToMir(term);
		expect(Pretty.display(fn)).toMatchSnapshot();
	});

	it("lowers proj from bound var", () => {
		const term = EB.DSL.proj("x", EB.DSL.bound(0));
		const ctx = mkCtx({ bound: [[0, "r"]] });
		const { instrs, value } = lower(term, ctx);
		expect(instrs).toHaveLength(1);
		expect(instrs[0]).toMatchObject({ type: "Read", label: "x", target: "r" });
		expect(value).toBeDefined();
	});
});
