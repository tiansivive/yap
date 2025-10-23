import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("Inference: lambdas", () => {
	it("explicit lambda without annotation", () => {
		const { displays, structure } = elaborateFrom("\\x -> 1");

		expect(structure.type).toMatchObject({ type: "Abs", binder: { type: "Pi", icit: "Explicit" } });

		expect(displays.constraints.length).toBe(0);

		const metas = Object.entries(structure.metas);
		expect(metas).toHaveLength(1);
		expect(structure.metas[1].ann).toMatchObject({ type: "Lit", value: { type: "Atom", value: "Type" } });

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("implicit lambda without annotation", () => {
		const { displays, structure } = elaborateFrom("\\x => 1");

		expect(structure.type).toMatchObject({ type: "Abs", binder: { type: "Pi", icit: "Implicit" } });

		const metas = Object.entries(structure.metas);
		expect(metas).toHaveLength(1);
		expect(structure.metas[1].ann).toMatchObject({ type: "Lit", value: { type: "Atom", value: "Type" } });

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("explicit lambda with param annotation", () => {
		const { displays, structure } = elaborateFrom("\\(x: String) -> 1");

		expect(structure.type).toMatchObject({ type: "Abs", binder: { type: "Pi", icit: "Explicit" } });

		const metas = Object.entries(structure.metas);
		expect(metas).toHaveLength(0);

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});
});
