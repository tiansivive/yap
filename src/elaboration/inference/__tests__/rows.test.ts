import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("Inference: type-level rows", () => {
	it("Row extension: [x: Num, y: String]", () => {
		const { structure, displays } = elaborateFrom("[ x: Num, y: String ]");
		expect(displays.type).toBe("Row");
		expect(structure.term).toMatchObject({ type: "Row", row: { type: "extension" } });

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("Record value extension \\r -> { foo: Num | r}", () => {
		const { structure, displays } = elaborateFrom("\\r -> { foo: Num | r }");

		expect(displays.type).toContain("r: ?1");
		expect(displays.type).toContain("Schema");
		expect(displays.type).toContain("foo: Type");
		expect(displays.constraints.join()).toContain("?1 ~~ Schema");

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("Record type polymorphism \\r:Row -> { foo: Num | r}", () => {
		const { structure, displays } = elaborateFrom("\\(r:Row) -> { foo: Num | r }");

		expect(displays.type).toContain("r: Row");
		expect(displays.type).toContain("Type");
		expect(displays.type).not.toContain("foo: Type");

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});
	it("Row literal with tail is unsupported", () => {
		expect(() => elaborateFrom("\\r -> [ x: Num | r ]")).toThrow(/Row literals with tails are not supported/);
	});
});
