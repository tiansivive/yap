import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: projection", () => {
	it("( { x: 1, y: 2 } ).x", () => {
		const res = elaborateFrom("{ x: 1, y: 2 }.x");
		// Projecting a Num field should yield Num
		expect(res.displays.type).toBe("Num");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});

	it("\\obj -> obj.x", () => {
		const res = elaborateFrom("\\obj -> obj.x");
		// The function should have type { x: a | r } -> a

		expect(res.displays.type).toContain("(obj: ?1) -> (closure: ?2");
		expect(res.displays.constraints).toContain("Schema [ x: ?2 | ?3 ] ~~ ?1");
		expect(res.structure.metas[3].ann).toMatchObject({ type: "Lit", value: { value: "Row" } });
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});

	it("{ let proj = \\obj -> obj.x; }", () => {
		const res = elaborateFrom("{ let proj = \\obj -> obj.x; }");
		// The let-bound function should have type { x: a | r } -> a

		//expect(res.displays.typedTerms["proj"].type).toContain("(obj: ?1) -> (closure: ?2 [ x: ?4 | ?5 ]");
		// expect(res.displays.constraints).toContain("(?2) [ x: ?4 | ?5 ] ~~ ?1");
		// expect(res.structure.metas[5].ann).toMatchObject({ type: "Lit", value: { value: "Row"} });
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});
});
