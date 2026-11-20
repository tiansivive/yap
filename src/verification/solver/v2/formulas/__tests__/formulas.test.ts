import { describe, expect, it } from "vitest";
import * as DSL from "../../../ivl/dsl";
import { run } from "../index";

describe("formulas", () => {
	it("runs normalization, skolemization, and separation", () => {
		const result = run(DSL.and(DSL.eq(DSL.x, DSL.int(1)), DSL.T));

		expect(result.normalized.tag).toBe("Atom");
		expect(result.skolemized.tag).toBe("Atom");
		expect(result.propositional.tag).toBe("Atom");
	});
});
