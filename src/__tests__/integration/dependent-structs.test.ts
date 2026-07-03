import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Integration — Nested dependent structs", () => {
	// Regression: nested dependent struct with sibling-label projection must
	// elaborate AND solve. Inference alone (unit tests) passes; the full
	// pipeline (which runs EB.solve) currently crashes in row unification.
	test("nested dependent struct with sibling-label projection", () => {
		const result = runScript(`{ point: { x: 1, y: 2 }, halved: { a: :point.x / 2, b: :point.y / 2 } }`);
		const decl = result.declarations[0];

		// Regression: elaboration + constraint solving must not crash, and the term
		// must lower all the way to MIR. (Verification/VC translation for row types is
		// a separate, out-of-scope gap tracked under Milestone 4 row theory.)
		expect(decl?.error ?? "").not.toContain("Cannot read properties of undefined");
		expect(decl?.stages?.mir).toBeTruthy();
		expect(snap(result)).toMatchSnapshot();
	});
});
