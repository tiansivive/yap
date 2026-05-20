import { describe, it, expect } from "vitest";
import * as DSL from "../ivl/dsl";
import { Build } from "../ivl/build";
import { Print } from "../ivl/print";
import type { IVL } from "../ivl/types";
import { Solver } from "../solver";
import { Trace } from "../trace";
import type { Step } from "../trace";

const tags = (steps: readonly Step[]) => steps.map(s => s.tag);

describe("Solver trace (end-to-end)", () => {
	describe("propositional", () => {
		it("trivial True produces sat trace", () => {
			const solver = Solver.createTraced();
			solver.assert(DSL.T);
			const { trace } = solver.check();
			const { steps, result } = Trace.collect(trace);

			expect(result.tag).toBe("sat");
			expect(tags(steps).at(-1)).toBe("sat");
		});

		it("trivial False produces unsat trace", () => {
			const solver = Solver.createTraced();
			solver.assert(DSL.F);
			const { trace } = solver.check();
			const { steps, result } = Trace.collect(trace);

			expect(result.tag).toBe("unsat");
			expect(tags(steps).at(-1)).toBe("unsat");
		});

		it("contradiction shows conflict and unsat", () => {
			const solver = Solver.createTraced();
			const e = DSL.eq(DSL.x, DSL.int(1));
			solver.assert(DSL.and(e, DSL.not(e)));
			const { trace } = solver.check();
			const { steps, result } = Trace.collect(trace);

			expect(result.tag).toBe("unsat");
			expect(steps.some(s => s.tag === "conflict")).toBe(true);
		});
	});

	describe("EUF theory", () => {
		it("EUF contradiction traces theory events", () => {
			const solver = Solver.createTraced();
			const f_x = Build.app("f", [DSL.x], Build.Int);
			const f_y = Build.app("f", [DSL.y], Build.Int);
			solver.assert(DSL.and(DSL.eq(DSL.x, DSL.y), DSL.neq(f_x, f_y)));
			const { trace } = solver.check();
			const { steps, result } = Trace.collect(trace);

			expect(result.tag).toBe("unsat");
			const theorySteps = steps.filter(s => s.tag === "theory-assert" || s.tag === "theory-check");
			expect(theorySteps.length).toBeGreaterThan(0);
		});
	});

	describe("arithmetic theory", () => {
		it("arithmetic UNSAT traces theory events", () => {
			const solver = Solver.createTraced();
			solver.assert(DSL.and(DSL.lte(DSL.add(DSL.x, DSL.y), DSL.int(5)), DSL.gte(DSL.x, DSL.int(3)), DSL.gte(DSL.y, DSL.int(3))));
			const { trace } = solver.check();
			const { steps, result } = Trace.collect(trace);

			expect(result.tag).toBe("unsat");
			const theoryChecks = steps.filter(s => s.tag === "theory-check");
			expect(theoryChecks.length).toBeGreaterThan(0);
		});

		it("simple arithmetic SAT traces decide and sat", () => {
			const solver = Solver.createTraced();
			solver.assert(DSL.gte(DSL.x, DSL.int(0)));
			const { trace } = solver.check();
			const { steps, result } = Trace.collect(trace);

			expect(result.tag).toBe("sat");
			expect(tags(steps).at(-1)).toBe("sat");
		});
	});

	describe("quantifiers", () => {
		it("quantifier formula traces quantifier-round events", () => {
			const solver = Solver.createTraced();
			const f_x = Build.app("f", [DSL.x], Build.Int);
			const f_a = Build.app("f", [Build.const_("a", Build.Int)], Build.Int);

			solver.assert(DSL.eq(f_a, DSL.int(1), "f_a_is_1"));
			solver.assert(DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(f_x, DSL.int(1)), "forall_f_neq_1", [{ terms: [f_x] }]));
			const { trace } = solver.check();
			const { steps, result } = Trace.collect(trace);

			expect(result.tag).toBe("unsat");
			const qRounds = steps.filter(s => s.tag === "quantifier-round");
			expect(qRounds.length).toBeGreaterThan(0);
		});
	});

	describe("trace formatting", () => {
		it("Trace.format renders readable output with atom names", () => {
			const solver = Solver.createTraced();
			solver.assert(DSL.and(DSL.eq(DSL.x, DSL.int(1)), DSL.not(DSL.eq(DSL.x, DSL.int(1)))));
			const { trace, atoms } = solver.check();
			const { steps } = Trace.collect(trace);

			const output = Trace.format(steps, atoms);
			expect(output).toContain("[");
			expect(output).toContain("=");
			expect(output.split("\n").length).toBeGreaterThan(1);
		});
	});

	describe("replay snapshots", () => {
		const replay = (f: IVL.Formula) => {
			const solver = Solver.createTraced();
			solver.assert(f);
			const { trace, atoms, proxies, clauses, arena } = solver.check();
			const { steps } = Trace.collect(trace);
			return Trace.replay({ formula: Print.formula(f), steps, atoms, proxies, clauses, arena });
		};

		const replayMulti = (...formulas: [IVL.Formula, string?][]) => {
			const solver = Solver.createTraced();
			formulas.forEach(([f, origin]) => solver.assert(f, origin));
			const combined = DSL.and(...formulas.map(([f]) => f));
			const { trace, atoms, proxies, clauses, arena } = solver.check();
			const { steps } = Trace.collect(trace);
			return Trace.replay({ formula: Print.formula(combined), steps, atoms, proxies, clauses, arena });
		};

		it("propositional contradiction", () => {
			const f = DSL.and(DSL.eq(DSL.x, DSL.int(1)), DSL.not(DSL.eq(DSL.x, DSL.int(1))));
			expect(replay(f)).toMatchSnapshot();
		});

		it("EUF contradiction (congruence closure)", () => {
			const f_x = Build.app("f", [DSL.x], Build.Int);
			const f_y = Build.app("f", [DSL.y], Build.Int);
			const f = DSL.and(DSL.eq(DSL.x, DSL.y), DSL.neq(f_x, f_y));
			expect(replay(f)).toMatchSnapshot();
		});

		it("arithmetic UNSAT", () => {
			const f = DSL.and(DSL.lte(DSL.add(DSL.x, DSL.y), DSL.int(5)), DSL.gte(DSL.x, DSL.int(3)), DSL.gte(DSL.y, DSL.int(3)));
			expect(replay(f)).toMatchSnapshot();
		});

		it("arithmetic SAT", () => {
			const f = DSL.and(DSL.gte(DSL.x, DSL.int(0)), DSL.lte(DSL.x, DSL.int(10)));
			expect(replay(f)).toMatchSnapshot();
		});

		it("quantifier UNSAT", () => {
			const f_x = Build.app("f", [DSL.x], Build.Int);
			const f_a = Build.app("f", [Build.const_("a", Build.Int)], Build.Int);

			expect(
				replayMulti(
					[DSL.eq(f_a, DSL.int(1)), "f_a_is_1"],
					[DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(f_x, DSL.int(1)), "forall_f_neq_1", [{ terms: [f_x] }])],
				),
			).toMatchSnapshot();
		});

		it("propositional contradiction (expanded mode)", () => {
			const solver = Solver.createTraced();
			const f = DSL.and(DSL.eq(DSL.x, DSL.int(1)), DSL.not(DSL.eq(DSL.x, DSL.int(1))));
			solver.assert(f);
			const { trace, atoms, proxies, clauses, arena } = solver.check();
			const { steps } = Trace.collect(trace);
			expect(Trace.replay({ formula: Print.formula(f), steps, atoms, proxies, clauses, arena, mode: "expanded" })).toMatchSnapshot();
		});
	});
});
