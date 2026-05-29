import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Polymorphism", () => {
	test("parametric polymorphism", () => {
		const result = runScript(`
let id: (a: Type) -> a -> a = \\a -> \\x -> x;
let const: (a: Type) -> (b: Type) -> a -> b -> a = \\a -> \\b -> \\x -> \\y -> x;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("implicit parameters", () => {
		const result = runScript(`
let id: (a: Type) => a -> a = \\x -> x;
let n2 = id 42;
let s2 = id "hello";
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("forcing implicits", () => {
		const result = runScript(`
let id: (a: Type) => a -> a = \\x -> x;
let forcedStr = id @String "hello";
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("inference and generalization", () => {
		const result = runScript(`
let inc = \\x -> x + 1;
let fst = \\x y -> x;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("let-polymorphism in blocks", () => {
		const result = runScript(`
let letpoly: Num = {
    let innerID = \\x -> x;
    let n: Num = innerID 42;
    let s: String = innerID "hi";
    return n;
};
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("implicit resolution with using", () => {
		const result = runScript(`
let addImplicit: (n: Num) => Num -> Num = \\x -> x + n;
using 10;
let eleven = addImplicit 1;
let fifteen = addImplicit 5;
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
