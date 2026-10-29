import { describe, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Primitives & Literals", () => {
	test("primitive bindings", async () => {
		const result = runScript(`
let greeting: String = "Hello, Yap!";
let life: Num = 42;
let b: Bool = true;
let u: Unit = !;
		`);
		await snap(result);
	});
});
