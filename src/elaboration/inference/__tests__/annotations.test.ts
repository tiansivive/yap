import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: annotations", () => {
	it("1 : Num", () => {
		const { displays, structure } = elaborateFrom("1: Num");
		expect(displays.term).toBe("1");
		expect(displays.type).toBe("Num");

		expect(structure.constraints.length).toBe(2);

		// Checks that the annotation is a Type
		expect(displays.constraints).toContain("Type ~~ Type");
		// Checks that the term type matches the annotation
		expect(displays.constraints).toContain("Num ~~ Num");

		expect(Object.entries(structure.metas)).toHaveLength(0);
		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});
});
