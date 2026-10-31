import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { run, type Options } from "../pipeline";

const options: Options = { deBruijn: "off", parserRule: "Ann", rawJson: false, ivlSimplify: true, evaluate: true, interpret: false };
const control = readFileSync(resolve(__dirname, "../../../../examples/effects/control-functions.yap"), "utf8");

describe("Explorer input boundary", () => {
	it.each(["Ann", "Script"] as const)("evaluates the pasted Control example with surrounding whitespace in %s mode", parserRule => {
		const result = run(`\n  ${control}\n`, { ...options, parserRule });
		expect(result.normalized).toBe("11");
		expect(result.errors.filter(error => error.startsWith("[Parse]"))).toEqual([]);
	});

	it("identifies input with zero completed parses as incomplete", () => {
		const result = run("with E: h in", options);
		expect(result.errors).toEqual([expect.stringContaining("[Parse] Incomplete input:")]);
	});
});
