import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Primitives & Literals", () => {
	test("primitive bindings", () => {
		const result = runScript(`
let greeting: String = "Hello, Yap!";
let life: Num = 42;
let b: Bool = true;
let u: Unit = !;
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
