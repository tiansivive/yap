import { describe, expect, it } from "vitest";
import { Build } from "../../ivl/build";
import * as DSL from "../../ivl/dsl";
import { Solver as V1 } from "../../solver";
import { Solver } from "../solver";

const fx = Build.app("f", [DSL.x], Build.Int);
const fa = Build.app("f", [Build.const_("a", Build.Int)], Build.Int);

describe("v2 solver API", () => {
	it.each([
		{ name: "true", formula: DSL.T },
		{ name: "false", formula: DSL.F },
		{ name: "propositional contradiction", formula: DSL.and(DSL.eq(DSL.x, DSL.int(1)), DSL.not(DSL.eq(DSL.x, DSL.int(1)))) },
		{ name: "arithmetic contradiction", formula: DSL.and(DSL.lte(DSL.add(DSL.x, DSL.y), DSL.int(5)), DSL.gte(DSL.x, DSL.int(3)), DSL.gte(DSL.y, DSL.int(3))) },
		{
			name: "quantifier contradiction",
			formula: DSL.and(DSL.eq(fa, DSL.int(1)), DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(fx, DSL.int(1)), "forall_f_neq_1", [{ terms: [fx] }])),
		},
	])("matches v1 result for $name", ({ formula }) => {
		const v1 = V1.create();
		const v2 = Solver.create();

		v1.assert(formula);
		v2.assert(formula);

		expect(v2.check().tag).toBe(v1.check().tag);
	});

	it("detects an EUF congruence contradiction v1 misses", () => {
		const solver = Solver.create();
		const f_x = Build.app("f", [DSL.x], Build.Int);
		const f_y = Build.app("f", [DSL.y], Build.Int);

		solver.assert(DSL.and(DSL.eq(DSL.x, DSL.y), DSL.neq(f_x, f_y)));

		expect(solver.check().tag).toBe("unsat");
	});

	it("restores assertions after pop", () => {
		const solver = Solver.create();
		solver.assert(DSL.eq(DSL.x, DSL.int(1)));
		solver.push();
		solver.assert(DSL.F);

		expect(solver.check().tag).toBe("unsat");

		solver.pop();

		expect(solver.check().tag).toBe("sat");
	});

	it("collects quantifier round trace events", () => {
		const solver = Solver.createTraced();
		solver.assert(DSL.eq(fa, DSL.int(1), "f_a_is_1"));
		solver.assert(DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(fx, DSL.int(1)), "forall_f_neq_1", [{ terms: [fx] }]));

		const check = solver.check();

		expect(check.result.tag).toBe("unsat");
		expect(check.steps.some(step => step.tag === "round")).toBe(true);
	});
});
