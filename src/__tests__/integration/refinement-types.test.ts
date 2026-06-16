import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

type Verdict = "valid" | "invalid";

const Verdict = {
	validity: (result: ReturnType<typeof runScript>, name: string): string | undefined => result.declarations.find(d => d.name === name)?.stages?.validity,
	expect: (result: ReturnType<typeof runScript>, name: string, expected: Verdict) => expect(Verdict.validity(result, name)).toBe(expected),
};

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

	test("negative refinement obligations", () => {
		const result = runScript(`
let negTestCheckLiteral: Num [| \\v -> v == 1 |] = 2;
let negFnApp: Num [| \\v -> v == 0 |] = 1 + 2;
let negTestCheckLambdaPreAndPostCondition: (n: Num [| \\n -> n > 0 |]) -> Num [| \\n -> n > 0 |] = \\x -> 0;
		`);
		Verdict.expect(result, "negTestCheckLiteral", "invalid");
		Verdict.expect(result, "negFnApp", "invalid");
		Verdict.expect(result, "negTestCheckLambdaPreAndPostCondition", "invalid");
		expect(snap(result)).toMatchSnapshot();
	});

	test("unconstrained identity fails positive postcondition", () => {
		const result = runScript(`
let negTestCheckLambdaPostCondition: Num -> Num [| \\n -> n > 0|] = \\x -> x;
		`);
		expect(snap(result)).toMatchSnapshot();
		Verdict.expect(result, "negTestCheckLambdaPostCondition", "invalid");
	});

	test("function refinement obligations", () => {
		const result = runScript(`
let fn: Num -> Num = \\x -> 2;
let posTestCheckLambdaPostCondition: Num -> Num [| \\v -> v == 1 |] = \\x -> 1;
let posTestCheckLambdaPreCondition: (n: Num [| \\n -> n > 0|]) -> Num = \\x -> x;
let posTestCheckLambdaPreAndPostCondition: (n: Num [| \\n -> n > 0|]) -> Num [| \\n -> n > 0|] = \\x -> x;
let posTestCheckRefinedResultLambda: (n: Num) -> Num [| \\o -> o == (n + 1) |] = \\x -> x + 1;
let inc: (x: Num) -> Num [| \\v -> v == (x + 1) |] = \\x -> x + 1;
		`);
		Verdict.expect(result, "fn", "valid");
		Verdict.expect(result, "posTestCheckLambdaPostCondition", "valid");
		Verdict.expect(result, "posTestCheckLambdaPreCondition", "valid");
		Verdict.expect(result, "posTestCheckLambdaPreAndPostCondition", "valid");
		Verdict.expect(result, "posTestCheckRefinedResultLambda", "valid");
		Verdict.expect(result, "inc", "valid");
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
		Verdict.expect(result, "badOne", "invalid");
		expect(snap(result)).toMatchSnapshot();
	});

	test("arithmetic refinement validated via MBQI", () => {
		const result = runScript(`
let goodOne: Num [| \\v -> v < 10 |] = 1;
		`);
		const [decl] = result.declarations;
		expect(decl.stages?.solverTrace).toContain("[mbqi]");
		expect(decl.stages?.solverTrace).toContain("[sat]");
		Verdict.expect(result, "goodOne", "valid");
		expect(snap(result)).toMatchSnapshot();
	});

	test("block refinement obligations", () => {
		const result = runScript(`
let block: Num [| \\n -> n > 0 |] = {
	let f: Num [| \\n -> n > 0 |] -> Num [| \\p -> p > 1 |] = \\o -> o + 1;
	return (f 1);
};
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("block-local let obligations verify through validity discharge", () => {
		const result = runScript(`
let compute: Num -> Num
	= \\x -> {
		let doubled = x * 2;
		let added = doubled + 10;
		return added;
	};
		`);
		expect(snap(result)).toMatchSnapshot();
		Verdict.expect(result, "compute", "valid");
	});

	test("dependent record construction", () => {
		const result = runScript(`
let test = {
	let Pair
	: (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
	= \\a -> \\b -> \\p -> { fst: a, snd: b[| \\v -> p :fst v |] };

	let p
	: Pair Num Num (\\x -> \\y -> x < y )
	= { fst: 1, snd: 2 };
};
		`);
		Verdict.expect(result, "test", "valid");
		expect(snap(result)).toMatchSnapshot();
	});

	test("dependent record construction rejects invalid field", () => {
		const result = runScript(`
let testFail = {
	let Pair
	: (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
	= \\a -> \\b -> \\p -> { fst: a, snd: b[| \\v -> p :fst v |] };

	let p
	: Pair Num Num (\\x -> \\y -> x < y )
	= { fst: 2, snd: 1 };

	return 1;
};
		`);
		Verdict.expect(result, "testFail", "invalid");
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

	test("ordered list construction rejects descending tail", () => {
		const result = runScript(`
let orderedListTestFail = {
	let List
	: (a: Type) -> (p: a -> a -> Bool) -> Type
	= \\t -> \\p -> | #nil Unit
	| #cons { head: t, tail: List (t[| \\v -> p :head v |]) p };

	let ol
	: List Num (\\x -> \\y -> x < y )
	= #cons { head: 2, tail: #cons { head: 1, tail: #nil ! } };

	return 1;
};
		`);
		Verdict.expect(result, "orderedListTestFail", "invalid");
		expect(snap(result)).toMatchSnapshot();
	});

	test("flow-sensitive refinements preserve branch facts", () => {
		const result = runScript(`
let test = {
	let a = 1;
	let b: Num[| \\n -> n > 0 |] = match (a > 0)
		| true  -> a
		| false -> 42;
	return 1;
};
		`);
		Verdict.expect(result, "test", "valid");
		expect(snap(result)).toMatchSnapshot();
	});
});
