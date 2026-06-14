import { describe, expect, it } from "vitest";
import * as DSL from "../../../ivl/dsl";
import { conflictValue, tag } from "../../__tests__/either";
import { State } from "../index";

const GT_ZERO = 1;
const LT_ZERO = 2;
const LTE_FIVE = 3;

describe("Arithmetic theory", () => {
	it("registers positive and negative literal constraints", () => {
		const state = State.register(State.empty, GT_ZERO, { op: ">", args: [DSL.x, DSL.int(0)] });

		expect(state.constraints.has(GT_ZERO)).toBe(true);
		expect(state.constraints.has(-GT_ZERO)).toBe(true);
		expect(state.bounds.has(GT_ZERO)).toBe(true);
		expect(state.bounds.has(-GT_ZERO)).toBe(true);
	});

	it("detects contradictory asserted bounds", () => {
		const withLower = State.register(State.empty, GT_ZERO, { op: ">", args: [DSL.x, DSL.int(0)] });
		const withUpper = State.register(withLower, LT_ZERO, { op: "<", args: [DSL.x, DSL.int(0)] });
		const assertedLower = conflictValue(State.assert(withUpper, GT_ZERO)).state;
		const conflict = State.assert(assertedLower, LT_ZERO);

		expect(tag(conflict)).toBe("Left");
	});

	it("checks satisfiable arithmetic state", () => {
		const registered = State.register(State.empty, LTE_FIVE, { op: "<=", args: [DSL.x, DSL.int(5)] });
		const asserted = conflictValue(State.assert(registered, LTE_FIVE)).state;

		expect(tag(State.check(asserted))).toBe("Right");
	});

	it("restores bounds after pop", () => {
		const registered = State.register(State.empty, GT_ZERO, { op: ">", args: [DSL.x, DSL.int(0)] });
		const entered = State.push(registered);
		const asserted = conflictValue(State.assert(entered, GT_ZERO)).state;
		const restored = State.pop(asserted);

		expect(restored.stack.length).toBe(0);
		expect(restored.tableau.bounds.get("x")?.lower).toBeUndefined();
	});
});
