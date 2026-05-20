import { describe, it, expect } from "vitest";
import { Solver } from "../solver";
import * as DSL from "../ivl/dsl";
import { Build } from "../ivl/build";
import { Triggers, type QuantifierInfo } from "../quantifiers/triggers";
import { EMatch, type Substitution } from "../quantifiers/ematch";
import { Arena, type ArenaState } from "../theories/euf/arena";

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
		let arena = Arena.create();
		const { id: aId, state: s1 } = Arena.intern(arena, "a", [], Build.Int);
		arena = s1;
		const { id: fId, state: s2 } = Arena.intern(arena, "f", [aId], Build.Int);
		arena = s2;

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

		// f(a) = 1
		solver.assert(DSL.eq(f_a, DSL.int(1), "f_a_is_1"));
		// forall x. f(x) != 1 (contradicts f(a) = 1)
		solver.assert(DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(f_x, DSL.int(1)), "forall_f_neq_1", [{ terms: [f_x] }]));

		const result = solver.check();
		expect(result.tag).toBe("unsat");
	});

	it("satisfies forall with consistent model", () => {
		const solver = Solver.create();
		const f_a = Build.app("f", [Build.const_("a", Build.Int)], Build.Int);
		const f_x = Build.app("f", [DSL.x], Build.Int);

		// f(a) = 1
		solver.assert(DSL.eq(f_a, DSL.int(1), "f_a_is_1"));
		// forall x. f(x) = f(x) (trivially true)
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
		// (x > 5 OR y < 3) AND x >= 0 — satisfiable
		solver.assert(DSL.or(DSL.gt(DSL.x, DSL.int(5)), DSL.lt(DSL.y, DSL.int(3))));
		solver.assert(DSL.gte(DSL.x, DSL.int(0)));
		const result = solver.check();
		expect(result.tag).toBe("sat");
	});
});
