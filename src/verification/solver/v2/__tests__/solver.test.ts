import { describe, expect, it } from "vitest";
import { Build } from "../../ivl/build";
import * as DSL from "../../ivl/dsl";
import { Solver } from "../solver";

const fx = Build.app("f", [DSL.x], Build.Int);
const fa = Build.app("f", [Build.const_("a", Build.Int)], Build.Int);

describe("v2 solver API", () => {
	it.each([
		{ name: "true", formula: DSL.T, expected: "sat" },
		{ name: "false", formula: DSL.F, expected: "unsat" },
		{ name: "propositional contradiction", formula: DSL.and(DSL.eq(DSL.x, DSL.int(1)), DSL.not(DSL.eq(DSL.x, DSL.int(1)))), expected: "unsat" },
		{
			name: "arithmetic contradiction",
			formula: DSL.and(DSL.lte(DSL.add(DSL.x, DSL.y), DSL.int(5)), DSL.gte(DSL.x, DSL.int(3)), DSL.gte(DSL.y, DSL.int(3))),
			expected: "unsat",
		},
		{
			name: "quantifier contradiction",
			formula: DSL.and(DSL.eq(fa, DSL.int(1)), DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(fx, DSL.int(1)), "forall_f_neq_1", [{ terms: [fx] }])),
			expected: "unsat",
		},
	] as const)("returns $expected for $name", ({ formula, expected }) => {
		expect(Solver.check(formula).tag).toBe(expected);
	});

	describe("linear real arithmetic", () => {
		const [x, y, a, r] = ["x", "y", "a", "r"].map(name => Build.var_(name, Build.Real));
		const n = (value: number) => Build.num(value, Build.Real);
		const plus = (l: typeof x, rt: typeof x) => Build.arith("+", l, rt, Build.Real);
		const minus = (l: typeof x, rt: typeof x) => Build.arith("-", l, rt, Build.Real);

		it.each([
			{ name: "x - y >= 1, x + y >= 3", formula: DSL.and(DSL.gte(minus(x, y), n(1)), DSL.gte(plus(x, y), n(3))), expected: "sat" },
			{ name: "x - y >= 1, x + y <= 0, y >= 0", formula: DSL.and(DSL.gte(minus(x, y), n(1)), DSL.lte(plus(x, y), n(0)), DSL.gte(y, n(0))), expected: "unsat" },
			{ name: "r >= 5, a <= 0, r = a", formula: DSL.and(DSL.gte(r, n(5)), DSL.lte(a, n(0)), DSL.eq(r, a)), expected: "unsat" },
			{ name: "a > 0, r = a, r <= 0", formula: DSL.and(DSL.gt(a, n(0)), DSL.eq(r, a), DSL.lte(r, n(0))), expected: "unsat" },
			{ name: "a > 0, r = a, r < 1", formula: DSL.and(DSL.gt(a, n(0)), DSL.eq(r, a), DSL.lt(r, n(1))), expected: "sat" },
			{ name: "x > 0, x <= 0", formula: DSL.and(DSL.gt(x, n(0)), DSL.lte(x, n(0))), expected: "unsat" },
			{ name: "x >= 0, x > 0, x <= 0", formula: DSL.and(DSL.gte(x, n(0)), DSL.gt(x, n(0)), DSL.lte(x, n(0))), expected: "unsat" },
			{ name: "x - y > 0, y - x > 0", formula: DSL.and(DSL.gt(minus(x, y), n(0)), DSL.gt(minus(y, x), n(0))), expected: "unsat" },
			{ name: "not (r < a), a >= 1, r <= 0", formula: DSL.and(DSL.not(DSL.lt(r, a)), DSL.gte(a, n(1)), DSL.lte(r, n(0))), expected: "unsat" },
			{ name: "not (x - y != 0), x >= 1, y <= 0", formula: DSL.and(DSL.not(DSL.neq(minus(x, y), n(0))), DSL.gte(x, n(1)), DSL.lte(y, n(0))), expected: "unsat" },
		] as const)("returns $expected for $name", ({ formula, expected }) => {
			expect(Solver.check(formula).tag).toBe(expected);
		});
	});

	describe("formulas as values", () => {
		const v = Build.const_("v", Build.Bool);
		const w = Build.const_("w", Build.Bool);
		const isTrue = (t: typeof v) => DSL.eq(t, Build.bool(true));

		it.each([
			{ name: "true = false", formula: DSL.eq(Build.bool(true), Build.bool(false)), expected: "unsat" },
			{ name: "v = true and v = false", formula: DSL.and(isTrue(v), DSL.eq(v, Build.bool(false))), expected: "unsat" },
			{
				name: "v = (a > 0), v, a <= 0",
				formula: DSL.and(DSL.eq(v, Build.prop(DSL.gt(DSL.a, DSL.int(0)))), isTrue(v), DSL.lte(DSL.a, DSL.int(0))),
				expected: "unsat",
			},
			{
				name: "v = (a > 0), w = (b > 5), v, not w",
				formula: DSL.and(
					DSL.eq(v, Build.prop(DSL.gt(DSL.a, DSL.int(0)))),
					DSL.eq(w, Build.prop(DSL.gt(DSL.b, DSL.int(5)))),
					isTrue(v),
					DSL.not(isTrue(w)),
				),
				expected: "sat",
			},
		] as const)("returns $expected for $name", ({ formula, expected }) => {
			expect(Solver.check(formula).tag).toBe(expected);
		});
	});

	it("detects an EUF congruence contradiction v1 misses", () => {
		const f_x = Build.app("f", [DSL.x], Build.Int);
		const f_y = Build.app("f", [DSL.y], Build.Int);

		expect(Solver.check(DSL.and(DSL.eq(DSL.x, DSL.y), DSL.neq(f_x, f_y))).tag).toBe("unsat");
	});

	it("collects quantifier round trace events", () => {
		const check = Solver.run(
			DSL.and(DSL.eq(fa, DSL.int(1), "f_a_is_1"), DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(fx, DSL.int(1)), "forall_f_neq_1", [{ terms: [fx] }])),
		);

		expect(check.result.tag).toBe("unsat");
		expect(check.steps.some(step => step.tag === "round")).toBe(true);
	});
});
