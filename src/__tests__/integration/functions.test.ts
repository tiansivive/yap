import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Functions & Application", () => {
	test("lambda expressions", () => {
		const result = runScript(`
let identity: Num -> Num = \\x -> x;
let const: Num -> String -> Num = \\x y -> x;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("function application", () => {
		const result = runScript(`
let identity: Num -> Num = \\x -> x;
let add: Num -> Num -> Num = \\x y -> x + y;
let forty2 = identity 42;
let added = add 10 20;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("higher-order functions", () => {
		const result = runScript(`
let compose: (Num -> Num) -> (Num -> Num) -> Num -> Num = \\f g x -> f (g x);
let add1 = \\x -> x + 1;
let add5 = \\x -> x + 5;
let double = \\x -> x * 2;
let add1ThenDouble = compose double add1;
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});

describe("Language Tour — Statement Blocks", () => {
	test("block with local bindings", () => {
		const result = runScript(`
let compute: Num -> Num = \\x -> {
    let doubled = x * 2;
    let added = doubled + 10;
    return added;
};
let result = compute 5;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("side effects in blocks", () => {
		const result = runScript(`
foreign print: String -> Unit;
foreign stringify: (a: Type) => a -> String;
let debug: Num -> Num = \\x -> {
    print "Computing...";
    let result = x * 2;
    print (stringify result);
    return result;
};
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
