import { describe, it, expect } from "vitest";
import { Solver } from "../solver";
import * as DSL from "../ivl/dsl";
import { Build } from "../ivl/build";
import { Triggers } from "../quantifiers/triggers";
import { EMatch } from "../quantifiers/ematch";
import { Arena } from "../theories/euf/arena";
import { Trace } from "../trace";

describe("Triggers", () => {
	it("extracts trigger from forall with function application", () => {
		const f_x = Build.app("f", [DSL.x], Build.Int);
		const formula = DSL.forall([{ name: "x", sort: Build.Int }], DSL.eq(f_x, DSL.x), "test-forall", [{ terms: [f_x] }]);

		const infos = Triggers.extract(formula);
		expect(infos).toHaveLength(1);
		expect(infos[0].triggers).toHaveLength(1);
		expect(infos[0].triggers[0].terms).toHaveLength(1);
	});

	it("extracts from nested And", () => {
		const f_x = Build.app("f", [DSL.x], Build.Int);
		const g_y = Build.app("g", [DSL.y], Build.Int);
		const q1 = DSL.forall([{ name: "x", sort: Build.Int }], DSL.eq(f_x, DSL.x), "q1", [{ terms: [f_x] }]);
		const q2 = DSL.forall([{ name: "y", sort: Build.Int }], DSL.eq(g_y, DSL.y), "q2", [{ terms: [g_y] }]);

		const infos = Triggers.extract(DSL.and(q1, q2));
		expect(infos).toHaveLength(2);
	});
});

describe("EMatch", () => {
	it("matches a known function application", () => {
		const { id: aId, state: s1 } = Arena.intern(Arena.create(), "a", [], Build.Int);
		const { state: arena } = Arena.intern(s1, "f", [aId], Build.Int);

		const trigger = Build.app("f", [DSL.x], Build.Int);
		const { substitutions } = EMatch.multi([trigger], arena, id => id);

		expect(substitutions.length).toBeGreaterThan(0);
	});
});

describe("Solver with quantifiers", () => {
	it("detects forall-based contradiction via EUF", () => {
		const solver = Solver.create();
		const f_a = Build.app("f", [Build.const_("a", Build.Int)], Build.Int);
		const f_x = Build.app("f", [DSL.x], Build.Int);

		solver.assert(DSL.eq(f_a, DSL.int(1), "f_a_is_1"));
		solver.assert(DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(f_x, DSL.int(1)), "forall_f_neq_1", [{ terms: [f_x] }]));

		const result = solver.check();
		expect(result.tag).toBe("unsat");
	});

	it("satisfies forall with consistent model", () => {
		const solver = Solver.create();
		const f_a = Build.app("f", [Build.const_("a", Build.Int)], Build.Int);
		const f_x = Build.app("f", [DSL.x], Build.Int);

		solver.assert(DSL.eq(f_a, DSL.int(1), "f_a_is_1"));
		solver.assert(DSL.forall([{ name: "x", sort: Build.Int }], DSL.eq(f_x, f_x), "forall_reflexive", [{ terms: [f_x] }]));

		const result = solver.check();
		expect(result.tag).toBe("sat");
	});
});

describe("Solver with arithmetic + quantifiers", () => {
	it("handles mixed arithmetic and EUF", () => {
		const solver = Solver.create();
		solver.assert(DSL.eq(DSL.x, DSL.int(5)));
		solver.assert(DSL.gt(DSL.x, DSL.int(3)));
		const result = solver.check();
		expect(result.tag).toBe("sat");
	});

	it("satisfies disjunction with arithmetic", () => {
		const solver = Solver.create();
		solver.assert(DSL.or(DSL.gt(DSL.x, DSL.int(5)), DSL.lt(DSL.y, DSL.int(3))));
		solver.assert(DSL.gte(DSL.x, DSL.int(0)));
		const result = solver.check();
		expect(result.tag).toBe("sat");
	});
});

describe("MBQI (Model-Based Quantifier Instantiation)", () => {
	it("detects arithmetic quantifier contradiction via MBQI", () => {
		const solver = Solver.create();
		const v = Build.var_("v", Build.Real);

		// No triggers exist (no function applications), so E-matching finds nothing;
		// MBQI must enumerate the body constant 1, grounding to (1 = 1 => 1 > 10) = false
		solver.assert(DSL.forall([{ name: "v", sort: Build.Real }], DSL.implies(DSL.eq(v, DSL.int(1)), DSL.gt(v, DSL.int(10))), "arithmetic_forall"));

		const result = solver.check();
		expect(result.tag).toBe("unsat");
	});

	it("satisfies valid arithmetic quantifier", () => {
		const solver = Solver.create();
		const v = Build.var_("v", Build.Real);

		solver.assert(DSL.forall([{ name: "v", sort: Build.Real }], DSL.implies(DSL.eq(v, DSL.int(5)), DSL.gte(v, DSL.int(0))), "valid_arithmetic_forall"));

		const result = solver.check();
		expect(result.tag).toBe("sat");
	});

	it("MBQI trace shows mbqi-round event for triggerless quantifiers", () => {
		const solver = Solver.createTraced();
		const v = Build.var_("v", Build.Real);

		solver.assert(DSL.forall([{ name: "v", sort: Build.Real }], DSL.implies(DSL.eq(v, DSL.int(1)), DSL.gt(v, DSL.int(10))), "triggerless_forall"));

		const { trace } = solver.check();
		const { steps, result } = Trace.collect(trace);

		expect(result.tag).toBe("unsat");
		const mbqiRounds = steps.filter(s => s.tag === "mbqi-round");
		expect(mbqiRounds.length).toBeGreaterThan(0);
	});

	it("detects contradiction with multiple arithmetic constants", () => {
		const solver = Solver.create();
		const v = Build.var_("v", Build.Real);

		// Seeds the arena with ground constant 2 for MBQI enumeration
		solver.assert(DSL.eq(DSL.int(2), DSL.int(2), "two_exists"));

		solver.assert(DSL.forall([{ name: "v", sort: Build.Real }], DSL.implies(DSL.eq(v, DSL.int(2)), DSL.lt(v, DSL.int(1))), "multi_const_forall"));

		const result = solver.check();
		expect(result.tag).toBe("unsat");
	});
});
