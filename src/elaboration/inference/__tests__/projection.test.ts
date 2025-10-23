import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: projection", () => {
	it("( { x: 1, y: 2 } ).x", () => {
		const res = elaborateFrom("{ x: 1, y: 2 }.x");
		// Projecting a Num field should yield Num
		expect(res.displays.type).toBe("Num");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
