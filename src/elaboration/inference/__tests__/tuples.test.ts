import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: tuple", () => {
	it("{1, 2}", () => {
		const res = elaborateFrom("{1, 2}");
		expect(res.displays.type.startsWith("Schema [")).toBe(true);
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
