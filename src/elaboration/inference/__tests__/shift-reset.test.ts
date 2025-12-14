import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("Inference: Shift/Reset", () => {
	describe("Reset", () => {
		it("should infer type for reset with simple value", () => {
			const src = "reset \\k -> k 10";
			const { displays, structure } = elaborateFrom(src);

			// Check that it elaborates successfully
			expect(structure.term.type).toBe("Reset");

			// Take snapshots
			expect({ displays }).toMatchSnapshot();
			expect({ structure }).toMatchSnapshot();
		});

		it("should add handler to context stack", () => {
			const src = "reset \\k v -> v 10";
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term.type).toBe("Reset");
			expect({ displays }).toMatchSnapshot();
		});
	});

	describe("Shift", () => {
		it("should error without enclosing reset", () => {
			const src = "shift 5";

			expect(() => elaborateFrom(src)).toThrow("shift without enclosing reset");
		});

		it("should infer type within reset", () => {
			const src = "reset \\k v -> k v shift 42";
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term.type).toBe("Reset");
			expect({ displays }).toMatchSnapshot();
			expect({ structure }).toMatchSnapshot();
		});
	});

	describe("Answer-type polymorphism", () => {
		it("should handle different answer and result types", () => {
			// Handler transforms number to string
			const src = 'reset \\k v -> "result" shift 123';
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term.type).toBe("Reset");
			expect({ displays }).toMatchSnapshot();
		});
	});
});
