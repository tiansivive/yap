import { describe, it, expect, beforeEach } from "vitest";
import * as E from "fp-ts/Either";
import { pipe } from "fp-ts/function";

import * as EB from "@yap/elaboration";
import * as GRAM from "../index";
import { interpret } from "../../lowering/interpret";
import { resetId } from "../graph";
import * as MIR from "../../lowering/mir";
import { display } from "../../lowering/pretty";
import { ARITIES } from "../../lowering/shared/primops";

const bridge = (term: EB.Term): MIR.Module =>
	pipe(
		GRAM.Pipeline.compile(term, { arities: ARITIES }),
		E.map(GRAM.Bridge.emit),
		E.getOrElseW(() => {
			throw new Error("pipeline failed");
		}),
	);

const via = (term: EB.Term) => interpret(bridge(term));

describe("GRAM Bridge: Phase 1 — leaves and structural ops", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
		MIR.resetId();
	});

	it("Lit(42) emits correctly", () => {
		const result = via(EB.DSL.num(42));
		expect(result).toBe(42);
	});

	it("Lit(true)", () => {
		expect(via(EB.DSL.bool(true))).toBe(true);
	});

	it("Lit(string)", () => {
		expect(via(EB.DSL.str("hello"))).toBe("hello");
	});

	it("struct { x: 1, y: 2 }", () => {
		const term = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		const result = via(term);
		expect(result).toEqual({ x: 1, y: 2 });
	});

	it("proj('x', struct { x: 42 })", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		const result = via(term);
		expect(result).toBe(42);
	});

	it("inj('z', 99, struct { x: 1 })", () => {
		const base = EB.DSL.struct([{ label: "x", value: EB.DSL.num(1) }]);
		const term = EB.DSL.inj("z", EB.DSL.num(99), base);
		const result = via(term) as Record<string, unknown>;
		expect(result.z).toBe(99);
		expect(result.x).toBe(1);
	});

	it("let x = 42 in x", () => {
		const term = EB.mk({
			type: "Abs",
			binding: { type: "Let", variable: "x", value: EB.DSL.num(42), annotation: EB.DSL.type("Num") },
			body: EB.DSL.bound(0),
		});
		const result = via(term);
		expect(result).toBe(42);
	});

	it("snapshot: struct { x: 1 }", () => {
		const term = EB.DSL.struct([{ label: "x", value: EB.DSL.num(1) }]);
		expect(display.module(bridge(term))).toMatchSnapshot();
	});

	it("snapshot: proj('x', struct { x: 42 })", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		expect(display.module(bridge(term))).toMatchSnapshot();
	});
});

describe("GRAM Bridge: Phase 2 — closures and primops", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
		MIR.resetId();
	});

	it("add(1, 2) — saturated primop", () => {
		const term = EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2));
		const result = via(term);
		expect(result).toBe(3);
	});

	it("mul(3, 4) — saturated primop", () => {
		const term = EB.DSL.mul(EB.DSL.num(3), EB.DSL.num(4));
		const result = via(term);
		expect(result).toBe(12);
	});

	it("(λx. x) 42 — identity closure", () => {
		const id = EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num"));
		const term = EB.DSL.app(id, EB.DSL.num(42));
		expect(display.module(bridge(term))).toMatchSnapshot();
		const result = via(term);
		expect(result).toBe(42);
	});

	it("(λx.λy. x+y) 3 4 — curried closure with captures", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(3)), EB.DSL.num(4));
		const result = via(term);
		expect(result).toBe(7);
	});

	it("snapshot: add(1, 2)", () => {
		const term = EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2));
		expect(display.module(bridge(term))).toMatchSnapshot();
	});
});

describe("GRAM Bridge: Phase 3 — pattern matching", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
		MIR.resetId();
	});

	it("match wildcard — always takes first alt", () => {
		const term = EB.DSL.match(EB.DSL.num(42), [{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(1) }]);
		const result = via(term);
		expect(result).toBe(1);
	});

	it("match literal 0 — takes matching branch", () => {
		const lam = EB.DSL.lambda(
			"x",
			EB.DSL.match(EB.DSL.bound(0), [
				{ pattern: EB.Constructors.Patterns.Lit({ type: "Num", value: 0 }), term: EB.DSL.num(1) },
				{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(2) },
			]),
			EB.DSL.type("Num"),
		);
		expect(via(EB.DSL.app(lam, EB.DSL.num(0)))).toBe(1);
	});

	it("match literal default — takes wildcard branch", () => {
		const lam = EB.DSL.lambda(
			"x",
			EB.DSL.match(EB.DSL.bound(0), [
				{ pattern: EB.Constructors.Patterns.Lit({ type: "Num", value: 0 }), term: EB.DSL.num(1) },
				{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(2) },
			]),
			EB.DSL.type("Num"),
		);
		expect(via(EB.DSL.app(lam, EB.DSL.num(99)))).toBe(2);
	});

	it("match variant Some/None — dispatches on tag", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.str("Some") },
			{ label: "Some", value: EB.DSL.num(42) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		expect(via(term)).toBe(42);
	});

	it("snapshot: match 0 / _", () => {
		const lam = EB.DSL.lambda(
			"x",
			EB.DSL.match(EB.DSL.bound(0), [
				{ pattern: EB.Constructors.Patterns.Lit({ type: "Num", value: 0 }), term: EB.DSL.num(1) },
				{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(2) },
			]),
			EB.DSL.type("Num"),
		);
		expect(display.module(bridge(EB.DSL.app(lam, EB.DSL.num(5))))).toMatchSnapshot();
	});
});
