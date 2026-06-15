import { describe, expect, it } from "vitest";
import { match } from "ts-pattern";
import * as Core from "../../core";
import { CDCL, type Clause, type Result } from "../index";

const collect = (clauses: Clause[]): { steps: { tag: string }[]; result: Result } => {
	const [collector] = Core.run(CDCL.solveTrace(clauses));
	return match(collector.result)
		.with({ _tag: "Right" }, ({ right }) => ({ steps: collector.steps, result: right }))
		.with({ _tag: "Left" }, ({ left }) => ({ steps: collector.steps, result: { tag: "unknown" as const, reason: left.cause.tag } }))
		.exhaustive();
};

describe("CDCL Core", () => {
	describe("trivial SAT", () => {
		it("satisfies a single positive unit clause", () => {
			const clauses: Clause[] = [{ literals: [1], origin: "test" }];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});

		it("satisfies a single negative unit clause", () => {
			const clauses: Clause[] = [{ literals: [-1], origin: "test" }];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});

		it("satisfies two compatible unit clauses", () => {
			const clauses: Clause[] = [
				{ literals: [1], origin: "test" },
				{ literals: [2], origin: "test" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});

		it("satisfies a disjunctive clause", () => {
			const clauses: Clause[] = [{ literals: [1, 2, 3], origin: "test" }];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});
	});

	describe("trivial UNSAT", () => {
		it("detects contradiction: x and not-x", () => {
			const clauses: Clause[] = [
				{ literals: [1], origin: "a" },
				{ literals: [-1], origin: "b" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("unsat");
		});

		it("detects empty clause", () => {
			const clauses: Clause[] = [{ literals: [], origin: "empty" }];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("unsat");
		});
	});

	describe("BCP propagation", () => {
		it("propagates through unit implications", () => {
			const clauses: Clause[] = [
				{ literals: [1], origin: "unit" },
				{ literals: [-1, 2], origin: "impl1" },
				{ literals: [-2, 3], origin: "impl2" },
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
			const clauses: Clause[] = [
				{ literals: [1], origin: "a" },
				{ literals: [-1, 2], origin: "b" },
				{ literals: [-2], origin: "c" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("unsat");
		});
	});

	describe("conflict analysis and backjumping", () => {
		it("solves pigeon-hole-like problem requiring backtrack", () => {
			const clauses: Clause[] = [
				{ literals: [1, 2], origin: "c1" },
				{ literals: [1, -2], origin: "c2" },
				{ literals: [-1, 2], origin: "c3" },
				{ literals: [-1, -2], origin: "c4" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("unsat");
		});

		it("learns clause and backtracks on 3-variable problem", () => {
			const clauses: Clause[] = [
				{ literals: [1, 2], origin: "c1" },
				{ literals: [-1, 3], origin: "c2" },
				{ literals: [-2, 3], origin: "c3" },
				{ literals: [-3, 1, 2], origin: "c4" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});
	});

	describe("larger instances", () => {
		it("solves a 5-variable satisfiable instance", () => {
			const clauses: Clause[] = [
				{ literals: [1, 2, 3], origin: "c1" },
				{ literals: [-1, -2, 4], origin: "c2" },
				{ literals: [-3, 5], origin: "c3" },
				{ literals: [-4, -5], origin: "c4" },
				{ literals: [2, -3, 4], origin: "c5" },
			];
			const result = CDCL.solve(clauses);
			expect(result.tag).toBe("sat");
		});
	});

	describe("trace events", () => {
		const tags = (steps: { tag: string }[]) => steps.map(s => s.tag);

		it("SAT trace ends with sat event", () => {
			const clauses: Clause[] = [{ literals: [1], origin: "test" }];
			const { steps, result } = collect(clauses);

			expect(result.tag).toBe("sat");
			expect(tags(steps).at(-1)).toBe("sat");
		});

		it("SAT trace contains propagate for unit clause", () => {
			const clauses: Clause[] = [{ literals: [1], origin: "test" }];
			const { steps } = collect(clauses);

			const propagations = steps.filter(s => s.tag === "propagate");
			expect(propagations.length).toBeGreaterThanOrEqual(1);
		});

		it("UNSAT trace ends with unsat event", () => {
			const clauses: Clause[] = [
				{ literals: [1], origin: "a" },
				{ literals: [-1], origin: "b" },
			];
			const { steps, result } = collect(clauses);

			expect(result.tag).toBe("unsat");
			expect(tags(steps).at(-1)).toBe("unsat");
		});

		it("UNSAT trace contains conflict event", () => {
			const clauses: Clause[] = [
				{ literals: [1], origin: "a" },
				{ literals: [-1], origin: "b" },
			];
			const { steps } = collect(clauses);

			expect(steps.some(s => s.tag === "conflict")).toBe(true);
		});

		it("backtracking trace includes decide, analyze, backjump", () => {
			const clauses: Clause[] = [
				{ literals: [1, 2], origin: "c1" },
				{ literals: [1, -2], origin: "c2" },
				{ literals: [-1, 2], origin: "c3" },
				{ literals: [-1, -2], origin: "c4" },
			];
			const { steps, result } = collect(clauses);

			expect(result.tag).toBe("unsat");
			const t = tags(steps);
			expect(t).toContain("decide");
			expect(t).toContain("analyze");
			expect(t).toContain("backjump");
		});

		it("BCP chain trace shows propagations", () => {
			const clauses: Clause[] = [
				{ literals: [1], origin: "unit" },
				{ literals: [-1, 2], origin: "impl1" },
				{ literals: [-2, 3], origin: "impl2" },
			];
			const { steps, result } = collect(clauses);

			expect(result.tag).toBe("sat");
			const propagations = steps.filter(s => s.tag === "propagate");
			expect(propagations.length).toBeGreaterThanOrEqual(3);
		});

		it("trace collection produces non-empty output", () => {
			const clauses: Clause[] = [
				{ literals: [1], origin: "a" },
				{ literals: [-1], origin: "b" },
			];
			const { steps } = collect(clauses);
			expect(steps.length).toBeGreaterThan(0);
		});
	});
});
