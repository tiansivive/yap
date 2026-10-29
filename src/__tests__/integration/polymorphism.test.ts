import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Polymorphism", () => {
	test("parametric polymorphism", async () => {
		const result = runScript(`
let id: (a: Type) -> a -> a = \\a -> \\x -> x;
let const: (a: Type) -> (b: Type) -> a -> b -> a = \\a -> \\b -> \\x -> \\y -> x;
		`);
		await snap(result);
	});

	test("implicit parameters", async () => {
		const result = runScript(`
let id: (a: Type) => a -> a = \\x -> x;
let n2 = id 42;
let s2 = id "hello";
		`);
		await snap(result);
	});

	test("forcing implicits", async () => {
		const result = runScript(`
let id: (a: Type) => a -> a = \\x -> x;
let forcedStr = id @String "hello";
		`);
		await snap(result);
	});

	test("inference and generalization", async () => {
		const result = runScript(`
let inc = \\x -> x + 1;
let fst = \\x y -> x;
		`);
		await snap(result);
	});

	test("let-polymorphism in blocks", async () => {
		const result = runScript(`
let letpoly: Num = {
    let innerID = \\x -> x;
    let n: Num = innerID 42;
    let s: String = innerID "hi";
    return n;
};
		`);
		await snap(result);
	});

	test("unused binding does not over-generalize the block", async () => {
		const result = runScript(`{ let proj = \\obj -> obj.x; }`);
		const type = result.declarations[0]?.stages?.type ?? "";
		// A unit-returning block whose only binding is unused has type `Unit`; a row meta from
		// the dead binding must not escape into the block-level generalization.
		expect(type).toBe("Unit");
		await snap(result);
	});

	test("implicit resolution with using", async () => {
		const result = runScript(`
let addImplicit: (n: Num) => Num -> Num = \\x -> x + n;
using 10;
let eleven = addImplicit 1;
let fifteen = addImplicit 5;
		`);
		await snap(result);
	});
});
