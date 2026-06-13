import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Refinement Types", () => {
	test("basic refinements", () => {
		const result = runScript(`
let Nat: Type = Num [| \\n -> n >= 0 |];
let Pos: Type = Num [| \\p -> p > 0 |];
let n: Nat = 42;
let p: Pos = 42;
let zero: Nat = 0;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("exact value refinements", () => {
		const result = runScript(`
let exactOne: Num [| \\v -> v == 1 |] = 1;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("pre and postconditions", () => {
		const result = runScript(`
let Nat: Type = Num [| \\n -> n >= 0 |];
let safe: (n: Nat) -> Nat = \\x -> x;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("input-output relationship", () => {
		const result = runScript(`
let inc: (x: Num) -> Num [| \\v -> v == (x + 1) |] = \\x -> x + 1;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("higher-order with refinements", () => {
		const result = runScript(`
let Nat: Type = Num [| \\n -> n >= 0 |];
let Pos: Type = Num [| \\p -> p > 0 |];
let hof: (f: Nat -> Nat) -> Nat = \\f -> f 1;
let hof2: (Num -> Nat) -> Pos = \\f -> (f 1) + 1;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("refinement subtyping", () => {
		const result = runScript(`
let Nat: Type = Num [| \\n -> n >= 0 |];
let Pos: Type = Num [| \\p -> p > 0 |];
let useNat: Nat -> Num = \\n -> n;
let p: Pos = 42;
let result = useNat p;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("contravariance", () => {
		const result = runScript(`
let Nat: Type = Num [| \\n -> n >= 0 |];
let Pos: Type = Num [| \\p -> p > 0 |];
let takePosFunction: (Pos -> Num) -> Num = \\f -> f 10;
let natToNum: Nat -> Num = \\x -> x;
let posToNum: Pos -> Num = \\x -> x;
let result1 = takePosFunction natToNum;
let result2 = takePosFunction posToNum;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("refinement polymorphism", () => {
		const result = runScript(`
let checkNum: (p: Num -> Bool) -> Num[| \\v -> p v |] -> Num = \\p x -> x;
let nat5 = checkNum (\\n -> n >= 0) 5;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("ordered pair", () => {
		const result = runScript(`
let OrderedPair: Type = { fst: Num, snd: Num[| \\v -> v > :fst |] };
let valid: OrderedPair = { fst: 3, snd: 5 };
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("arithmetic refinement contradiction requiring MBQI", () => {
		const result = runScript(`
let badOne: Num [| \\v -> v > 10 |] = 1;
		`);
		const [decl] = result.declarations;
		expect(decl.stages?.solverTrace).toContain("[mbqi]");
		expect(decl.stages?.solverTrace).toContain("[unsat]");
		expect(snap(result)).toMatchSnapshot();
	});

	test("arithmetic refinement validated via MBQI", () => {
		const result = runScript(`
let goodOne: Num [| \\v -> v < 10 |] = 1;
		`);
		const [decl] = result.declarations;
		expect(decl.stages?.solverTrace).toContain("[mbqi]");
		expect(decl.stages?.solverTrace).toContain("[sat]");
		expect(snap(result)).toMatchSnapshot();
	});

	test("ordered lists with refinement polymorphism", () => {
		const result = runScript(`
let OrderedList: (t: Type) -> (p: t -> t -> Bool) -> Type = \\t -> \\p -> | #nil Unit | #cons { head: t, tail: OrderedList (t[| \\v -> p :head v |]) p };
let ascending: OrderedList Num (\\x -> \\y -> x < y) = #cons { head: 1, tail: #cons { head: 2, tail: #cons { head: 3, tail: #nil ! } } };
let descending: OrderedList Num (\\x -> \\y -> x > y) = #cons { head: 3, tail: #cons { head: 2, tail: #cons { head: 1, tail: #nil ! } } };
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
