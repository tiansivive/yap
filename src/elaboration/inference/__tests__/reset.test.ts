import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("Inference: reset", () => {
	it("simple reset", () => {
		const { displays, structure } = elaborateFrom("reset (\\k v -> k v) 42");

		expect(structure.term.type).toBe("Reset");

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it("reset with lambda body", () => {
		const { displays, structure } = elaborateFrom("reset (\\k v -> k v) (\\x -> x)");

		expect(structure.term.type).toBe("Reset");

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});
});
