import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: block", () => {
	it("{ return 1; }", () => {
		const res = elaborateFrom("{ return 1; }");
		expect(res.displays.type).toBe("Num");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});

	it("{ let x = 1; return x; }", () => {
		const res = elaborateFrom("{ let x = 1; return x; }");
		expect(res.displays.type).toBe("Num");
		expect(res.displays.constraints.join()).toContain("Num ~~ ?1");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
