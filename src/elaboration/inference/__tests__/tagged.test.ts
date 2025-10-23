import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: tagged", () => {
	it("#x 1", () => {
		const res = elaborateFrom("#x 1");
		expect(res.displays.type).toBe("Variant [ x: Num | ?1 ]");
		expect(res.displays.constraints.length).toBe(0);

		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
