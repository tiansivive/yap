import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Integration — Nested dependent structs", () => {
	test("Nu self-observation verifies against a dependent schema", () => {
		const result = runScript(`
let pair: { a: Num, b: Num[| \\v -> v == (&a + 1) |] } = { a: 2, b: $a + 1 };
		`);
		const decl = result.declarations.find(d => d.name === "pair");

		expect(decl?.stages?.ivl).not.toBe("");
		expect(decl?.stages?.validity).toBe("valid");
	});

	test("a field calls an already elaborated sibling function", () => {
		const result = runScript(`let r = { f: \\(x: Num) -> x + 1, g: \\(y: Num) -> $f y };`);
		const decl = result.declarations[0];

		expect(decl?.errors).toEqual({});
		expect(decl?.stages?.type).toMatch(/g: Π\(y: Num\)[\s\S]*FFI\.\$add y 1/);
		expect(decl?.stages?.validity).toBe("valid");
	});

	test("nested dependent struct with sibling-label projection", async () => {
		const result = runScript(`{ point: { x: 1, y: 2 }, halved: { a: $point.x / 2, b: $point.y / 2 } }`);
		const decl = result.declarations[0];

		expect(decl?.errors).toEqual({});
		expect(decl?.stages?.ivl).not.toBe("");
		expect(decl?.stages?.validity).toBe("valid");
		expect(decl?.stages?.mir).toBeTruthy();
		await snap(result);
	});
});
