import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Records & Tuples", () => {
	test("records", async () => {
		const result = runScript(`
let point: { x: Num, y: Num } = { x: 0, y: 10 };
let person: { name: String, age: Num } = { name: "Alice", age: 30 };
		`);
		await snap(result);
	});

	test("self-referencing fields", async () => {
		const result = runScript(`
let rectangle: { width: Num, height: Num, area: Num }
    = { width: 10, height: 20, area: $width * $height };
		`);
		await snap(result);
	});

	test("field access", async () => {
		const result = runScript(`
let point = { x: 10, y: 20 };
let xCoord = point.x;
let getX: { x: Num, y: Num } -> Num = \\p -> p.x;
		`);
		await snap(result);
	});

	test("field extension", async () => {
		const result = runScript(`
let point = { x: 10 };
let point3d = { point | y = 20, z = 30 };
let updated = { point | x = 100 };
let updatedX = updated.x;
		`);
		await snap(result);
	});

	test("tuples", async () => {
		const result = runScript(`
let pair: { Num, String } = { 42, "answer" };
let pairExplicit: { 0: Num, 1: String } = { 0: 42, 1: "answer" };
		`);
		await snap(result);
	});

	test("arrays and dictionaries", async () => {
		const result = runScript(`
let array: { [Num]: Num } = [1, 2, 3];
let dict: { [String]: Num } = { one: 1, two: 2, three: 3 };
		`);
		await snap(result);
	});
});

describe("Language Tour — Records in generated code", () => {
	const run = (src: string) => runInNewContext(`(function () { ${runScript(src).declarations[0]?.stages?.codegenJS ?? ""} })()`);

	test("a field reads a variable bound outside the record", () => {
		const mk = run(`let mk = \\(y: Num) -> { a: y };`);
		expect(mk.__fn(mk.__env, 5)).toEqual({ a: 5 });
	});

	test("a label read under a lambda sees its record", () => {
		const { add } = run(`let counter = { base: 10, add: \\(n: Num) -> n + $base };`);
		expect(add.__fn(add.__env, 5)).toBe(15);
	});

	test("a lambda in a record reads both a label and an outer variable", () => {
		const mk = run(`let mk = \\y -> { base: y, add: \\n -> n + $base };`);
		const { add } = mk.__fn(mk.__env, 7);
		expect(add.__fn(add.__env, 5)).toBe(12);
	});
});
