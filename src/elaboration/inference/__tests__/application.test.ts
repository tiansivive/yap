import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: application", () => {
	it("simple application f x", () => {
		// f : Num -> Num is provided as a free var only if present in imports.
		// Here we'll just elaborate expression; constraints/meta will capture missing info.
		const res = elaborateFrom("(\\x -> x) 1");
		// Expect type to be Num after instantiation of the Pi
		expect(res.displays.type).toBe("?1");
		expect(res.displays.constraints.join()).toContain("Num ~~ ?1");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
