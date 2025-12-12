import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("Inference: shift", () => {
	it("simple shift", () => {
		const { displays, structure } = elaborateFrom("shift 42");

		expect(structure.term.type).toBe("Shift");

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("shift with string literal", () => {
		const { displays, structure } = elaborateFrom('shift "hello"');

		expect(structure.term.type).toBe("Shift");

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});
});
