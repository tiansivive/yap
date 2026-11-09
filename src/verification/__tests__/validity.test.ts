import { describe, expect, it } from "vitest";
import { Build } from "../solver/ivl/build";
import * as DSL from "../solver/ivl/dsl";
import type { IVL } from "../solver/ivl/types";
import { Solver } from "../solver/v2/solver";
import { Validity } from "../validity";

const forallX = (body: IVL.Formula): IVL.Formula => DSL.forall([{ name: "x", sort: Build.Int }], body);

describe("VC validity discharge", () => {
	it("distinguishes raw satisfiability from verifier validity", () => {
		const formula = DSL.gt(DSL.x, DSL.int(0));

		expect(Solver.check(formula).tag).toBe("sat");
		expect(Validity.check(formula).tag).toBe("invalid");
	});

	it.each([
		{
			name: "unguarded valid universal",
			formula: forallX(DSL.eq(DSL.x, DSL.x)),
			expected: "valid",
		},
		{
			name: "valid guarded universal",
			formula: forallX(DSL.implies(DSL.eq(DSL.x, DSL.int(1)), DSL.gt(DSL.x, DSL.int(0)))),
			expected: "valid",
		},
		{
			name: "invalid guarded universal",
			formula: forallX(DSL.implies(DSL.eq(DSL.x, DSL.int(0)), DSL.gt(DSL.x, DSL.int(0)))),
			expected: "invalid",
		},
	] as const)("reports $expected for $name", ({ formula, expected }) => {
		expect(Validity.check(formula).tag).toBe(expected);
	});

	it("combines conjunctions as validity obligations", () => {
		const formula = DSL.and(forallX(DSL.eq(DSL.x, DSL.x)), forallX(DSL.gt(DSL.x, DSL.int(0))));

		expect(Validity.check(formula).tag).toBe("invalid");
	});

	it.each([
		["first", 0],
		["middle", 1],
		["last", 2],
	] as const)("checks the %s conjunct under a binder", (_name, position) => {
		const conjuncts = [0, 1, 2].map(i => DSL.eq(DSL.x, i === position ? DSL.int(0) : DSL.x));

		expect(Validity.check(forallX(DSL.and(...conjuncts))).tag).toBe("invalid");
	});

	it("checks repeated conjuncts under a binder", () => {
		const formula = forallX(DSL.and(DSL.eq(DSL.x, DSL.int(0)), DSL.eq(DSL.x, DSL.int(0))));

		expect(Validity.check(formula).tag).toBe("invalid");
	});

	it("uses an implication guard to prove every conjunct", () => {
		const formula = forallX(DSL.implies(DSL.eq(DSL.x, DSL.int(1)), DSL.and(DSL.eq(DSL.x, DSL.int(1)), DSL.gt(DSL.x, DSL.int(0)))));

		expect(Validity.check(formula).tag).toBe("valid");
	});
});
