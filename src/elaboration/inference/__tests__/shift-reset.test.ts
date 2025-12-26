import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe.skip("Inference: Shift/Reset", () => {
	describe("Reset", () => {
		it("should infer type for reset with simple value", () => {
			const src = "reset 10 with \\k v -> k !";
			const { displays, structure } = elaborateFrom(src);

			// Check that it elaborates successfully
			expect(structure.term.type).toBe("Reset");

			// Take snapshots
			expect({ displays }).toMatchSnapshot();
			expect({ structure }).toMatchSnapshot();
		});

		it("should add handler to context stack", () => {
			const src = "reset 10 with \\k v -> v";
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
			const src = "reset shift 42 with \\k v -> k v";
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term.type).toBe("Reset");
			expect({ displays }).toMatchSnapshot();
			expect({ structure }).toMatchSnapshot();
		});
	});

	describe("Answer-type polymorphism", () => {
		it("should handle different answer and result types", () => {
			// Handler transforms number to string
			const src = 'reset shift 123 with \\k v -> "result"';
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term.type).toBe("Reset");
			expect({ displays }).toMatchSnapshot();
		});

		it("should handle compound expression with shift", () => {
			const src = "\\f -> reset (f 10 (shift 10)) with \\k v -> 0";
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term.type).toBe("Reset");
			expect({ displays }).toMatchSnapshot();
		});
	});
});
