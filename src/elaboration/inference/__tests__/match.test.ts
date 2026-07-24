import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: match", () => {
	it("match 1 | 1 -> 2", () => {
		const res = elaborateFrom("match 1 | 1 -> 2");
		expect({ displays: res.displays }).toMatchSnapshot();
	});

	it("match { x: 1 } | { x: a } -> a", () => {
		const res = elaborateFrom("match { x: 1 } | { x: a } -> a");
		expect({ displays: res.displays }).toMatchSnapshot();
	});

	describe("branch unification", () => {
		it('mismatched branch types: match 1 | 1 -> 2 | 3 -> "hello"', () => {
			const res = elaborateFrom('\\(x: Num) -> match x | 1 -> 2 | 3 -> "hello"');
			expect({ displays: res.displays }).toMatchSnapshot();
		});
	});

	describe("variable patterns", () => {
		it("match x | y -> 2 | z -> 4", () => {
			const res = elaborateFrom("\\(x: Num) -> match x | y -> 2 | z -> 4");
			expect({ displays: res.displays }).toMatchSnapshot();
		});
	});

	describe("struct patterns", () => {
		it("struct pattern with literal fields", () => {
			const res = elaborateFrom("\\(x: Num) -> match x | { x: 1, y: 2 } -> 11 | { z: 3, w: 4 } -> 22");
			expect({ displays: res.displays }).toMatchSnapshot();
		});

		it("struct pattern with row polymorphism", () => {
			const res = elaborateFrom("\\(x: Num) -> match x | { x: 1, y: 2 | r } -> r | { z: 3, w: 4 | r } -> x");
			expect({ displays: res.displays }).toMatchSnapshot();
		});

		it("variable binding in struct patterns", () => {
			const res = elaborateFrom("\\(x: Num) -> match x | { x: y } -> y | { z: w } -> w");
			expect({ displays: res.displays }).toMatchSnapshot();
		});

		it("nested recursive struct patterns with application", () => {
			const res = elaborateFrom("\\(x: Num) -> match x | { foo: { y: y }, bar: f } -> f y | { z: { w: w } } -> w");
			expect({ displays: res.displays }).toMatchSnapshot();
		});
	});

	describe("type patterns", () => {
		it("match on type constructors: Num, String", () => {
			const res = elaborateFrom('\\(x: Num) -> match x | Num -> 1 | String -> "hello"');
			expect({ displays: res.displays }).toMatchSnapshot();
		});
	});

	describe("variant patterns", () => {
		it("match on variant tags: #nil, #cons", () => {
			const res = elaborateFrom("\\(x: Num) -> match x | #nil a -> 0 | #cons {el, rest} -> 1");
			expect({ displays: res.displays }).toMatchSnapshot();
		});
	});
});
