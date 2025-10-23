import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("Inference: Structs", () => {
	it('multiple fields: { x: 1, y: "hello" }', () => {
		const { structure, displays } = elaborateFrom('{ x: 1, y: "hello" }');
		expect(displays.type).toMatch("Schema");
		expect(displays.type).toContain("x: Num");
		expect(displays.type).toContain("y: String");

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});
});
