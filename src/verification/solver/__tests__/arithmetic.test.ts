import { describe, it, expect } from "vitest";
import * as E from "fp-ts/Either";
import { Simplex } from "../theories/arithmetic/simplex";
import { Rational } from "../theories/arithmetic/rational";
import { Normalize } from "../theories/arithmetic/normalize";
import { Solver, type SolveResult } from "../solver";
import * as DSL from "../ivl/dsl";
import { Build } from "../ivl/build";

describe("Rational", () => {
	it("normalizes fractions", () => {
		const r = Rational.of(4n, 6n);
		expect(r.num).toBe(2n);
		expect(r.den).toBe(3n);
	});

	it("handles negative denominators", () => {
		const r = Rational.of(3n, -5n);
		expect(r.num).toBe(-3n);
		expect(r.den).toBe(5n);
	});

	it("adds rationals", () => {
		const result = Rational.add(Rational.of(1n, 3n), Rational.of(1n, 6n));
		expect(result.num).toBe(1n);
		expect(result.den).toBe(2n);
	});

	it("compares rationals", () => {
		expect(Rational.lt(Rational.of(1n, 3n), Rational.of(1n, 2n))).toBe(true);
		expect(Rational.gt(Rational.of(2n, 3n), Rational.of(1n, 2n))).toBe(true);
	});

	it("computes floor and ceil", () => {
		const r = Rational.of(7n, 3n);
		expect(Rational.floor(r)).toEqual(Rational.of(2n));
		expect(Rational.ceil(r)).toEqual(Rational.of(3n));
	});

	it("computes floor for negatives", () => {
		const r = Rational.of(-7n, 3n);
		expect(Rational.floor(r)).toEqual(Rational.of(-3n));
		expect(Rational.ceil(r)).toEqual(Rational.of(-2n));
	});
});

describe("Simplex", () => {
	it("satisfies trivial bounds", () => {
		const tab = Simplex.Variable.add(Simplex.create(), "x");
		const result = Simplex.Assert.lower(tab, "x", { value: Rational.of(-1n), strict: false, reason: 1 });
		expect(E.isRight(result)).toBe(true);
	});

	it("detects direct bound conflict", () => {
		const tab = Simplex.Variable.add(Simplex.create(), "x");
		const step1 = Simplex.Assert.lower(tab, "x", { value: Rational.of(5n), strict: false, reason: 1 });
		expect(E.isRight(step1)).toBe(true);

		const step2 = Simplex.Assert.upper((step1 as E.Right<typeof tab>).right, "x", { value: Rational.of(3n), strict: false, reason: 2 });
		expect(E.isLeft(step2)).toBe(true);
	});

	it("repairs basic variable via pivot", () => {
		const t0 = Simplex.Variable.add(Simplex.create(), "x");
		const t1 = Simplex.Variable.add(t0, "y");
		// slack = x + y, assert slack <= 5, x >= 3, y >= 3
		const t2 = Simplex.Row.add(
			t1,
			"s",
			new Map([
				["x", Rational.one],
				["y", Rational.one],
			]),
		);
		const t3 = E.getOrElse(() => t2)(Simplex.Assert.upper(t2, "s", { value: Rational.of(5n), strict: false, reason: 1 }));
		const t4 = E.getOrElse(() => t3)(Simplex.Assert.lower(t3, "x", { value: Rational.of(3n), strict: false, reason: 2 }));
		const t5 = E.getOrElse(() => t4)(Simplex.Assert.lower(t4, "y", { value: Rational.of(3n), strict: false, reason: 3 }));

		const result = Simplex.check(t5);
		expect(E.isLeft(result)).toBe(true);
	});
});

describe("Normalize", () => {
	it("normalizes x <= 5", () => {
		const result = Normalize.atom({
			op: "<=",
			args: [DSL.x, DSL.int(5)],
		});
		expect(result.tag).toBe("linear");
	});

	it("normalizes x + y > 3", () => {
		const result = Normalize.atom({
			op: ">",
			args: [DSL.add(DSL.x, DSL.y), DSL.int(3)],
		});
		expect(result.tag).toBe("linear");
	});

	it("returns nonlinear for x * y", () => {
		const result = Normalize.atom({
			op: "<=",
			args: [DSL.mul(DSL.x, DSL.y), DSL.int(5)],
		});
		expect(result.tag).toBe("nonlinear");
	});

	it("linearizes constant * variable", () => {
		const result = Normalize.atom({
			op: "<=",
			args: [DSL.mul(DSL.int(3), DSL.x), DSL.int(9)],
		});
		expect(result.tag).toBe("linear");
	});
});

describe("Solver with arithmetic", () => {
	const check = (
		formula: DSL.typeof_not extends never ? never : Parameters<typeof Solver.create>[0] extends undefined ? ReturnType<typeof Solver.create> : never,
	): SolveResult => {
		// Helper not needed, using inline
		return {} as SolveResult;
	};

	it("detects x > 0 AND x < 0 as UNSAT", () => {
		const solver = Solver.create();
		solver.assert(DSL.gt(DSL.x, DSL.int(0)));
		solver.assert(DSL.lt(DSL.x, DSL.int(0)));
		const result = solver.check();
		expect(result.tag).toBe("unsat");
	});

	it("satisfies x > 0 AND x < 10", () => {
		const solver = Solver.create();
		solver.assert(DSL.gt(DSL.x, DSL.int(0)));
		solver.assert(DSL.lt(DSL.x, DSL.int(10)));
		const result = solver.check();
		expect(result.tag).toBe("sat");
	});

	it("detects x <= 5 AND x >= 10 as UNSAT", () => {
		const solver = Solver.create();
		solver.assert(DSL.lte(DSL.x, DSL.int(5)));
		solver.assert(DSL.gte(DSL.x, DSL.int(10)));
		const result = solver.check();
		expect(result.tag).toBe("unsat");
	});

	it("satisfies x + y <= 10 AND x >= 3 AND y >= 3", () => {
		const solver = Solver.create();
		solver.assert(DSL.lte(DSL.add(DSL.x, DSL.y), DSL.int(10)));
		solver.assert(DSL.gte(DSL.x, DSL.int(3)));
		solver.assert(DSL.gte(DSL.y, DSL.int(3)));
		const result = solver.check();
		expect(result.tag).toBe("sat");
	});

	it("detects x + y <= 5 AND x >= 3 AND y >= 3 as UNSAT", () => {
		const solver = Solver.create();
		solver.assert(DSL.lte(DSL.add(DSL.x, DSL.y), DSL.int(5)));
		solver.assert(DSL.gte(DSL.x, DSL.int(3)));
		solver.assert(DSL.gte(DSL.y, DSL.int(3)));
		const result = solver.check();
		expect(result.tag).toBe("unsat");
	});

	it("handles equality: x = 5 AND x > 6 is UNSAT", () => {
		const solver = Solver.create();
		solver.assert(DSL.eq(DSL.x, DSL.int(5)));
		solver.assert(DSL.gt(DSL.x, DSL.int(6)));
		const result = solver.check();
		expect(result.tag).toBe("unsat");
	});

	it("mixed EUF + arithmetic: f(x) = y AND x > 0", () => {
		const f = Build.app("f", [DSL.x], Build.Int);
		const solver = Solver.create();
		solver.assert(DSL.eq(f, DSL.y));
		solver.assert(DSL.gt(DSL.x, DSL.int(0)));
		const result = solver.check();
		expect(result.tag).toBe("sat");
	});
});
