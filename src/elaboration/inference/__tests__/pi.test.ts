import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: pi/arrow", () => {
	it("arrow type: Num -> Num", () => {
		const { structure, displays } = elaborateFrom("Num -> Num");
		expect(displays.type).toBe("Type");

		expect(structure.constraints.length).toBe(2);
		// checks the argument is a Type
		expect(displays.constraints[0]).toContain("Type ~~ Type");
		// checks the body is a Type
		expect(displays.constraints[1]).toContain("Type ~~ Type");
		expect(Object.entries(structure.metas)).toHaveLength(0);

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("pi explicit: (x: Num) -> Num", () => {
		const { structure, displays } = elaborateFrom("(x: Num) -> Num");
		expect(displays.type).toBe("Type");
		expect(structure.constraints.length).toBe(2);
		// checks the argument is a Type
		expect(displays.constraints[0]).toContain("Type ~~ Type");
		// checks the body is a Type
		expect(displays.constraints[1]).toContain("Type ~~ Type");
		expect(Object.entries(structure.metas)).toHaveLength(0);

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("pi implicit: (x: Num) => Num", () => {
		const { structure, displays } = elaborateFrom("(x: Num) => Num");
		expect(displays.type).toBe("Type");

		expect(structure.constraints.length).toBe(2);
		// checks the argument is a Type
		expect(displays.constraints[0]).toContain("Type ~~ Type");
		// checks the body is a Type
		expect(displays.constraints[1]).toContain("Type ~~ Type");
		expect(Object.entries(structure.metas)).toHaveLength(0);

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("output type must be a Type: (x: Num) -> x", () => {
		const { structure, displays } = elaborateFrom("(x: Num) -> x");
		expect(displays.type).toBe("Type");

		expect(structure.constraints.length).toBe(2);
		// checks the argument is a Type
		expect(displays.constraints[0]).toContain("Type ~~ Type");
		// checks the body is a Type
		expect(displays.constraints[1]).toContain("Num ~~ Type");
		expect(Object.entries(structure.metas)).toHaveLength(0);

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});
});
