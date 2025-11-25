import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";
import { stripKeys } from "../../../__tests__/setup";

describe("Inference: Literals", () => {
	it("numbers: 1 >=> Num", () => {
		const { displays, structure } = elaborateFrom("1");
		expect(displays.type).toBe("Num");

		expect(displays.constraints.length).toBe(0);
		expect(Object.entries(structure.metas)).toHaveLength(0);

		//const stripped = stripKeys({ structure }, ["ffi", "imports"])
		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("Boolean: true >=> Boolean", () => {
		const { displays, structure } = elaborateFrom("true");
		expect(displays.type).toBe("Bool");

		expect(displays.constraints.length).toBe(0);
		expect(Object.entries(structure.metas)).toHaveLength(0);

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it('String: "hello" >=> String', () => {
		const { displays, structure } = elaborateFrom('"hello"');
		expect(displays.type).toBe("String");

		expect(displays.constraints.length).toBe(0);
		expect(Object.entries(structure.metas)).toHaveLength(0);

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("Unit: ! >=> Unit", () => {
		const { displays, structure } = elaborateFrom("!");
		expect(displays.type).toBe("Unit");

		expect(displays.constraints.length).toBe(0);
		expect(Object.entries(structure.metas)).toHaveLength(0);

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("Type: Type >=> Type", () => {
		const { displays, structure } = elaborateFrom("Type");
		expect(displays.type).toBe("Type");

		expect(displays.constraints.length).toBe(0);
		expect(Object.entries(structure.metas)).toHaveLength(0);

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("Row: Row >=> Type", () => {
		const { displays, structure } = elaborateFrom("Row");
		expect(displays.type).toBe("Type");

		expect(displays.constraints.length).toBe(0);
		expect(Object.entries(structure.metas)).toHaveLength(0);

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});
});
