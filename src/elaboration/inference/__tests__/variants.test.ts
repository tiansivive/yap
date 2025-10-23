import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: variant type", () => {
	it("| #x Num | #y Num", () => {
		const res = elaborateFrom("| #x Num | #y Num");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
