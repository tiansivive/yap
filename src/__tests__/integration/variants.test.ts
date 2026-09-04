import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Variants & Tagged Values", () => {
	test("simple variants", () => {
		const result = runScript(`
let TrafficLight: Type = | #red Unit | #yellow Unit | #green Unit;
let light: TrafficLight = #red !;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("variants with data", () => {
		const result = runScript(`
let Shape: Type
    = | #circle Num
      | #rectangle { Num, Num }
      | #point { x: Num, y: Num };
let c: Shape = #circle 5.0;
let r: Shape = #rectangle { 10, 20 };
let p: Shape = #point { x: 0, y: 0 };
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});

describe("Language Tour — Pattern Matching", () => {
	test("literal patterns", () => {
		const result = runScript(`
let isZero: Num -> Bool = \\n -> match n
    | 0 -> true
    | _ -> false;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("record patterns", () => {
		const result = runScript(`
let getY: { x: Num, y: Num } -> Num = \\p -> match p
    | { x: a, y: b } -> b;
let getY2: { x: Num, y: Num } -> Num = \\p -> match p
    | { y: a } -> a;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("variant patterns", () => {
		const result = runScript(`
let Shape: Type
    = | #circle Num
      | #rectangle { Num, Num }
      | #point { x: Num, y: Num };
let describeShape: Shape -> String = \\s -> match s
    | #circle r -> "Circle with radius"
    | #rectangle { w, h } -> "Rectangle"
    | #point { x: _, y: _ } -> "Point at coordinates";
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("list patterns", () => {
		const result = runScript(`
let firstOrZero: { [Num]: Num } -> Num = \\list -> match list
    | [] -> 0
    | [x | xs] -> x;
let tail: { [Num]: Num } -> { [Num]: Num } = \\list -> match list
    | [] -> []
    | [x | xs] -> xs;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("recursive functions", () => {
		const result = runScript(`
let List: Type -> Type = \\a -> | #nil Unit | #cons { a, List a };
let length: (a: Type) => List a -> Num = \\list -> match list
    | #nil _ -> 0
    | #cons { x, xs } -> 1 + (length xs);
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("recursive record fields", () => {
		const result = runScript(`
let Factorial: Type = { compute: Num -> Num };
let fact: Factorial = { compute: \\n -> match n
    | 0 -> 1
    | _ -> n * (:compute (n - 1)) };
let result = fact.compute 5;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	/* Unrefined recursive type let: normalization must seal the Mu instead of unfolding it. */
	test("recursive list type", () => {
		const result = runScript(`
let List: (t: Type) -> Type = \\t -> | #nil Unit | #cons { head: t, tail: List t };
let xs: List Num = #cons { head: 1, tail: #cons { head: 2, tail: #nil ! } };
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
