import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: hole", () => {
	it("_", () => {
		const res = elaborateFrom("_");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
