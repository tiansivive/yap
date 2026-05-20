import { describe, it, expect } from "vitest";
import { match } from "ts-pattern";
import { CDCL, type Clause } from "../cdcl/core";
import { Trace } from "../trace";
import type { Step } from "../trace";

describe("CDCL Core", () => {
	describe("trivial SAT", () => {
		it("satisfies a single positive unit clause", () => {
			const clauses: Clause[] = [{ id: 0, literals: [1], origin: "test" }];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});

		it("satisfies a single negative unit clause", () => {
			const clauses: Clause[] = [{ id: 0, literals: [-1], origin: "test" }];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});

		it("satisfies two compatible unit clauses", () => {
			const clauses: Clause[] = [
				{ id: 0, literals: [1], origin: "test" },
				{ id: 1, literals: [2], origin: "test" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});

		it("satisfies a disjunctive clause", () => {
			const clauses: Clause[] = [{ id: 0, literals: [1, 2, 3], origin: "test" }];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});
	});

	describe("trivial UNSAT", () => {
		it("detects contradiction: x and not-x", () => {
			const clauses: Clause[] = [
				{ id: 0, literals: [1], origin: "a" },
				{ id: 1, literals: [-1], origin: "b" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("unsat");
		});

		it("detects empty clause", () => {
			const clauses: Clause[] = [{ id: 0, literals: [], origin: "empty" }];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("unsat");
		});
	});

	describe("BCP propagation", () => {
		it("propagates through unit implications", () => {
			const clauses: Clause[] = [
				{ id: 0, literals: [1], origin: "unit" },
				{ id: 1, literals: [-1, 2], origin: "impl1" },
				{ id: 2, literals: [-2, 3], origin: "impl2" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
			match(result)
				.with({ tag: "sat" }, ({ assignments }) => {
					expect(assignments.get(1)).toBe("true");
					expect(assignments.get(2)).toBe("true");
					expect(assignments.get(3)).toBe("true");
				})
				.otherwise(() => {});
		});

		it("detects conflict during propagation", () => {
			// x1, (not-x1 or x2), (not-x2), x2
			const clauses: Clause[] = [
				{ id: 0, literals: [1], origin: "a" },
				{ id: 1, literals: [-1, 2], origin: "b" },
				{ id: 2, literals: [-2], origin: "c" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("unsat");
		});
	});

	describe("conflict analysis and backjumping", () => {
		it("solves pigeon-hole-like problem requiring backtrack", () => {
			// (x1 or x2), (x1 or not-x2), (not-x1 or x2), (not-x1 or not-x2)
			const clauses: Clause[] = [
				{ id: 0, literals: [1, 2], origin: "c1" },
				{ id: 1, literals: [1, -2], origin: "c2" },
				{ id: 2, literals: [-1, 2], origin: "c3" },
				{ id: 3, literals: [-1, -2], origin: "c4" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("unsat");
		});

		it("learns clause and backtracks on 3-variable problem", () => {
			// SAT: (1 or 2), (-1 or 3), (-2 or 3), (-3 or 1 or 2)
			const clauses: Clause[] = [
				{ id: 0, literals: [1, 2], origin: "c1" },
				{ id: 1, literals: [-1, 3], origin: "c2" },
				{ id: 2, literals: [-2, 3], origin: "c3" },
				{ id: 3, literals: [-3, 1, 2], origin: "c4" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});
	});

	describe("larger instances", () => {
		it("solves a 5-variable satisfiable instance", () => {
			const clauses: Clause[] = [
				{ id: 0, literals: [1, 2, 3], origin: "c1" },
				{ id: 1, literals: [-1, -2, 4], origin: "c2" },
				{ id: 2, literals: [-3, 5], origin: "c3" },
				{ id: 3, literals: [-4, -5], origin: "c4" },
				{ id: 4, literals: [2, -3, 4], origin: "c5" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});
	});

	describe("trace events", () => {
		const tags = (steps: readonly Step[]) => steps.map(s => s.tag);

		it("SAT trace ends with sat event", () => {
			const clauses: Clause[] = [{ id: 0, literals: [1], origin: "test" }];
			const { steps, result } = Trace.collect(CDCL.solveTrace(clauses));

			expect(result.tag).toBe("sat");
			expect(tags(steps).at(-1)).toBe("sat");
		});

		it("SAT trace contains propagate for unit clause", () => {
			const clauses: Clause[] = [{ id: 0, literals: [1], origin: "test" }];
			const { steps } = Trace.collect(CDCL.solveTrace(clauses));

			const propagations = steps.filter(s => s.tag === "propagate");
			expect(propagations.length).toBeGreaterThanOrEqual(1);
		});

		it("UNSAT trace ends with unsat event", () => {
			const clauses: Clause[] = [
				{ id: 0, literals: [1], origin: "a" },
				{ id: 1, literals: [-1], origin: "b" },
			];
			const { steps, result } = Trace.collect(CDCL.solveTrace(clauses));

			expect(result.tag).toBe("unsat");
			expect(tags(steps).at(-1)).toBe("unsat");
		});

		it("UNSAT trace contains conflict event", () => {
			const clauses: Clause[] = [
				{ id: 0, literals: [1], origin: "a" },
				{ id: 1, literals: [-1], origin: "b" },
			];
			const { steps } = Trace.collect(CDCL.solveTrace(clauses));

			expect(steps.some(s => s.tag === "conflict")).toBe(true);
		});

		it("backtracking trace includes decide, analyze, backjump", () => {
			const clauses: Clause[] = [
				{ id: 0, literals: [1, 2], origin: "c1" },
				{ id: 1, literals: [1, -2], origin: "c2" },
				{ id: 2, literals: [-1, 2], origin: "c3" },
				{ id: 3, literals: [-1, -2], origin: "c4" },
			];
			const { steps, result } = Trace.collect(CDCL.solveTrace(clauses));

			expect(result.tag).toBe("unsat");
			const t = tags(steps);
			expect(t).toContain("decide");
			expect(t).toContain("analyze");
			expect(t).toContain("backjump");
		});

		it("BCP chain trace shows propagations", () => {
			const clauses: Clause[] = [
				{ id: 0, literals: [1], origin: "unit" },
				{ id: 1, literals: [-1, 2], origin: "impl1" },
				{ id: 2, literals: [-2, 3], origin: "impl2" },
			];
			const { steps, result } = Trace.collect(CDCL.solveTrace(clauses));

			expect(result.tag).toBe("sat");
			const propagations = steps.filter(s => s.tag === "propagate");
			expect(propagations.length).toBeGreaterThanOrEqual(3);
		});

		it("Trace.format produces non-empty output", () => {
			const clauses: Clause[] = [
				{ id: 0, literals: [1], origin: "a" },
				{ id: 1, literals: [-1], origin: "b" },
			];
			const { steps } = Trace.collect(CDCL.solveTrace(clauses));
			const output = Trace.format(steps);

			expect(output.length).toBeGreaterThan(0);
			expect(output).toContain("[");
		});
	});
});
