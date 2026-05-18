import { describe, it, expect } from "vitest";
import { match } from "ts-pattern";
import { Solver } from "../solver";
import * as DSL from "../ivl/dsl";

describe("Solver", () => {
	describe("propositional satisfiability", () => {
		it("trivial True is sat", () => {
			const solver = Solver.create();
			solver.assert(DSL.T);
			expect(solver.check().tag).toBe("sat");
		});

		it("trivial False is unsat", () => {
			const solver = Solver.create();
			solver.assert(DSL.F);
			expect(solver.check().tag).toBe("unsat");
		});

		it("simple equality atom is sat", () => {
			const solver = Solver.create();
			solver.assert(DSL.eq(DSL.x, DSL.int(42), "test"));
			expect(solver.check().tag).toBe("sat");
		});

		it("contradiction is unsat", () => {
			const solver = Solver.create();
			const e = DSL.eq(DSL.x, DSL.int(1));
			solver.assert(DSL.and(e, DSL.not(e)));
			expect(solver.check().tag).toBe("unsat");
		});
	});

	describe("conjunction handling", () => {
		it("conjuncts are all satisfiable", () => {
			const solver = Solver.create();
			solver.assert(DSL.and(DSL.eq(DSL.x, DSL.int(1)), DSL.eq(DSL.y, DSL.int(2))));
			expect(solver.check().tag).toBe("sat");
		});
	});

	describe("implication", () => {
		it("handles implication with True guard", () => {
			const solver = Solver.create();
			solver.assert(DSL.implies(DSL.T, DSL.gt(DSL.x, DSL.int(0)), "guard"));
			expect(solver.check().tag).toBe("sat");
		});
	});

	describe("push/pop", () => {
		it("restores state after pop", () => {
			const solver = Solver.create();
			solver.assert(DSL.eq(DSL.x, DSL.int(1)));

			solver.push();
			solver.assert(DSL.F);
			expect(solver.check().tag).toBe("unsat");

			solver.pop();
			expect(solver.check().tag).toBe("sat");
		});
	});

	describe("UNSAT core origin tracking", () => {
		it("returns origins in unsat core", () => {
			const solver = Solver.create();
			solver.assert(DSL.and(DSL.eq(DSL.x, DSL.int(1), "constraint-a"), DSL.not(DSL.eq(DSL.x, DSL.int(1), "constraint-b"), "neg-b")));
			const result = solver.check();
			expect(result.tag).toBe("unsat");
			match(result)
				.with({ tag: "unsat" }, ({ core }) => {
					expect(core.length).toBeGreaterThan(0);
				})
				.otherwise(() => {});
		});
	});
});
