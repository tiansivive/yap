import { describe, expect, it } from "vitest";
import { Rational } from "../index";

describe("Rational", () => {
	it("normalizes fractions", () => {
		expect(Rational.of(4n, 6n)).toEqual(Rational.of(2n, 3n));
	});

	it("normalizes negative denominators", () => {
		expect(Rational.of(3n, -5n)).toEqual({ num: -3n, den: 5n });
	});

	it("adds rationals", () => {
		expect(Rational.add(Rational.of(1n, 3n), Rational.of(1n, 6n))).toEqual(Rational.of(1n, 2n));
	});

	it("compares rationals", () => {
		expect(Rational.lt(Rational.of(1n, 3n), Rational.of(1n, 2n))).toBe(true);
		expect(Rational.gt(Rational.of(2n, 3n), Rational.of(1n, 2n))).toBe(true);
	});

	it("computes floor and ceil", () => {
		expect(Rational.floor(Rational.of(7n, 3n))).toEqual(Rational.of(2n));
		expect(Rational.ceil(Rational.of(7n, 3n))).toEqual(Rational.of(3n));
	});

	it("computes floor and ceil for negatives", () => {
		expect(Rational.floor(Rational.of(-7n, 3n))).toEqual(Rational.of(-3n));
		expect(Rational.ceil(Rational.of(-7n, 3n))).toEqual(Rational.of(-2n));
	});
});
