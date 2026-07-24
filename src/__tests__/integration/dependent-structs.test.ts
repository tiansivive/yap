import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Integration — Nested dependent structs", () => {
	test("nested dependent struct with sibling-label projection", () => {
		const result = runScript(`{ point: { x: 1, y: 2 }, halved: { a: :point.x / 2, b: :point.y / 2 } }`);
		const decl = result.declarations[0];

		expect(decl?.error).toBeUndefined();
		expect(decl?.stages?.ivl).not.toBe("");
		expect(decl?.stages?.validity).toBe("valid");
		expect(decl?.stages?.mir).toBeTruthy();
		expect(snap(result)).toMatchSnapshot();
	});
});
