import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: injection", () => {
	it("{ { x: 1 } | y = 2 }", () => {
		const res = elaborateFrom("{ { x: 1 } | y = 2 }");
		expect(res.displays.type).toBe("Schema [ y: Num, x: Num ]");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
