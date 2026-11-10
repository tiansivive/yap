import { describe, expect, it } from "vitest";
import { Delta } from "../delta";
import type { Row, Tableau } from "../simplex";
import { conflictValue, tag } from "../../__tests__/either";
import { Rational, Simplex } from "../index";

describe("Simplex", () => {
	it.each([1n, -2n])("preserves all row equations when the entering coefficient is %s", coefficient => {
		const initial = tableau(
			new Map([
				[
					"s",
					new Map([
						["x", Rational.of(coefficient)],
						["y", Rational.of(3n)],
					]),
				],
				[
					"t",
					new Map([
						["x", Rational.one],
						["y", Rational.minusOne],
					]),
				],
			]),
		);
		const bounded = conflictValue(Simplex.lower(initial, "s", { value: Rational.of(3n), strict: false, reason: 1 }));
		const repaired = feasible(initial, bounded);

		expect(repaired.basic.has("x")).toBe(true);
		expect(Simplex.value(repaired, "x")).toEqual(Delta.of(Rational.of(3n, coefficient), Rational.zero));
		expect(Simplex.value(repaired, "t")).toEqual(Simplex.value(repaired, "x"));
	});

	it("satisfies two multivariable bounds after successive pivots", () => {
		const initial = tableau(
			new Map([
				[
					"s",
					new Map([
						["x", Rational.one],
						["y", Rational.minusOne],
					]),
				],
				[
					"t",
					new Map([
						["x", Rational.one],
						["y", Rational.one],
					]),
				],
			]),
		);
		const first = conflictValue(Simplex.lower(initial, "s", { value: Rational.one, strict: false, reason: 1 }));
		const second = conflictValue(Simplex.lower(first, "t", { value: Rational.of(3n), strict: false, reason: 2 }));

		const repaired = feasible(initial, second);

		expect(repaired.basic).not.toEqual(initial.basic);
	});

	it("repairs an upper violation while the lower bound holds", () => {
		const initial = tableau(
			new Map([
				[
					"s",
					new Map([
						["x", Rational.one],
						["y", Rational.one],
					]),
				],
			]),
		);
		const lower = conflictValue(Simplex.lower(initial, "s", { value: Rational.zero, strict: false, reason: 1 }));
		const upper = conflictValue(Simplex.upper(lower, "s", { value: Rational.one, strict: false, reason: 2 }));
		const moved = conflictValue(Simplex.lower(upper, "x", { value: Rational.of(2n), strict: false, reason: 3 }));
		const repaired = feasible(initial, moved);

		expect(Simplex.value(repaired, "s")).toEqual(Delta.of(Rational.one, Rational.zero));
	});

	it.each(["lower", "upper"] as const)("retains the stricter %s bound at an equal endpoint", direction => {
		const initial = Simplex.variable(Simplex.empty, "x");
		const closed = conflictValue(Simplex[direction](initial, "x", { value: Rational.zero, strict: false, reason: 1 }));
		const strict = conflictValue(Simplex[direction](closed, "x", { value: Rational.zero, strict: true, reason: 2 }));
		const weakened = conflictValue(Simplex[direction](strict, "x", { value: Rational.zero, strict: false, reason: 3 }));
		const repaired = feasible(initial, weakened);

		expect(closed.bounds.get("x")?.[direction]).toEqual({ value: Delta.zero, reason: 1 });
		expect(repaired.bounds.get("x")?.[direction]).toEqual({
			value: Delta.of(Rational.zero, direction === "lower" ? Rational.one : Rational.minusOne),
			reason: 2,
		});
	});

	it("preserves a strict rational interval through a pivot", () => {
		const initial = tableau(
			new Map([
				[
					"s",
					new Map([
						["x", Rational.of(2n)],
						["y", Rational.one],
					]),
				],
			]),
		);
		const lower = conflictValue(Simplex.lower(initial, "s", { value: Rational.of(1n, 3n), strict: true, reason: 1 }));
		const upper = conflictValue(Simplex.upper(lower, "s", { value: Rational.of(1n, 2n), strict: true, reason: 2 }));
		const repaired = feasible(initial, upper);

		expect(Simplex.value(repaired, "x")).toEqual(Delta.of(Rational.of(1n, 6n), Rational.of(1n, 2n)));
	});

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

const tableau = (rows: ReadonlyMap<string, Row>): Tableau => {
	const names = new Set([...rows.values()].flatMap(row => [...row.keys()]));
	const variables = [...names].reduce(Simplex.variable, Simplex.empty);
	return [...rows].reduce((tab, [name, row]) => Simplex.row(tab, name, row), variables);
};

const feasible = (original: Tableau, bounded: Tableau): Tableau => {
	const repaired = conflictValue(Simplex.check(bounded));
	[...original.rows, ...repaired.rows].forEach(([variable, row]) => {
		const expected = [...row].reduce((value, [name, coefficient]) => Delta.add(value, Delta.scale(Simplex.value(repaired, name), coefficient)), Delta.zero);
		expect(Simplex.value(repaired, variable)).toEqual(expected);
	});
	[...repaired.bounds].forEach(([variable, bounds]) => {
		(["lower", "upper"] as const).forEach(direction => {
			const bound = bounds[direction];

			if (!bound) {
				return;
			}
			const value = Simplex.value(repaired, variable);
			const satisfies = direction === "lower" ? Delta.geq(value, bound.value) : Delta.leq(value, bound.value);
			expect(satisfies, `${variable} ${direction} bound`).toBe(true);
		});
	});
	return repaired;
};
