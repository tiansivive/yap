import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: modal", () => {
	it.skip("<*> 1", () => {
		const res = elaborateFrom("<*> Num");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
