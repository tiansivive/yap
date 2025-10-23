import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: match", () => {
	it("match 1 | 1 -> 2", () => {
		const res = elaborateFrom("match 1 | 1 -> 2");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});

	it("match { x: 1 } | { x: a } -> a", () => {
		const res = elaborateFrom("match { x: 1 } | { x: a } -> a");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
