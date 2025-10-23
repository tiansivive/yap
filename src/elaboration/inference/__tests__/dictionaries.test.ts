import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: dictionaries", () => {
	it("{[ Num ]: Num}", () => {
		const res = elaborateFrom("{[ Num ]: Num }");
		expect(res.displays.type).toBe("Type");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
