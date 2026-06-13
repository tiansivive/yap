import { describe, expect, it } from "vitest";
import { conflictValue, tag } from "../../__tests__/either";
import { Rational, Simplex } from "../index";

describe("Simplex", () => {
	it("satisfies trivial bounds", () => {
		const tab = Simplex.variable(Simplex.empty, "x");
		const result = Simplex.lower(tab, "x", { value: Rational.of(-1n), strict: false, reason: 1 });

		expect(tag(result)).toBe("Right");
	});

	it("detects direct bound conflict", () => {
		const tab = Simplex.variable(Simplex.empty, "x");
		const lower = conflictValue(Simplex.lower(tab, "x", { value: Rational.of(5n), strict: false, reason: 1 }));
		const upper = Simplex.upper(lower, "x", { value: Rational.of(3n), strict: false, reason: 2 });

		expect(tag(upper)).toBe("Left");
	});

	it("reports infeasible basic variables after repair fails", () => {
		const withX = Simplex.variable(Simplex.empty, "x");
		const withY = Simplex.variable(withX, "y");
		const withSlack = Simplex.row(
			withY,
			"s",
			new Map([
				["x", Rational.one],
				["y", Rational.one],
			]),
		);
		const boundedSlack = conflictValue(Simplex.upper(withSlack, "s", { value: Rational.of(5n), strict: false, reason: 1 }));
		const boundedX = conflictValue(Simplex.lower(boundedSlack, "x", { value: Rational.of(3n), strict: false, reason: 2 }));
		const boundedY = conflictValue(Simplex.lower(boundedX, "y", { value: Rational.of(3n), strict: false, reason: 3 }));

		expect(tag(Simplex.check(boundedY))).toBe("Left");
	});
});
