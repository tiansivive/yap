import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: list", () => {
	it("[1, 2, 3]", () => {
		const res = elaborateFrom("[1, 2, 3]");
		expect(res.displays.type).toContain("Indexed Num ?2");
		expect(res.displays.constraints.join()).toContain("Num ~~ ?2");

		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
