import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("Inference: Shift/Reset", () => {
	describe("Reset", () => {
		it("should infer type for reset with simple value", () => {
			const src = "reset 10";
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term).toMatchObject({ type: "Block", return: { type: "Reset" } });
			expect(displays.term).toContain("|10|");
			expect(displays.term).not.toContain("bubble#");
			expect(displays.constraints).toEqual(expect.arrayContaining([expect.stringMatching(/^Num ~~ \?\d+$/)]));
		});

		it("should infer a bubble for shift without resume values", () => {
			const src = 'reset (shift "world")';
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term).toMatchObject({ type: "Block", return: { type: "Reset" } });
			expect(displays.term).toContain("bubble#");
			expect(displays.term).toContain("capture");
			expect(displays.term).toContain('"world"');
			expect(displays.term).not.toContain('$k "world"');
			expect(displays.constraints).toEqual(expect.arrayContaining([expect.stringMatching(/^String ~~ \?\d+$/)]));
		});
	});

	describe("Shift", () => {
		it("should error without enclosing reset", () => {
			const src = "shift 5";

			expect(() => elaborateFrom(src)).toThrow("shift without enclosing reset");
		});

		it("should infer type within reset", () => {
			const src = 'reset (shift (resume "hello"))';
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term).toMatchObject({ type: "Block", return: { type: "Reset" } });
			expect(displays.term).toContain("bubble#");
			expect(displays.term).toContain("capture");
			expect(displays.term).toContain('$k "hello"');
			expect(displays.constraints).toEqual(expect.arrayContaining([expect.stringMatching(/^String ~~ \?\d+$/)]));
		});
	});

	describe("Answer-type polymorphism", () => {
		it("should handle different answer and result types", () => {
			const src = 'reset (1 + (shift "hello"))';
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term).toMatchObject({ type: "Block", return: { type: "Reset" } });
			expect(displays.term).toContain("FFI.$add");
			expect(displays.term).toContain("bubble#");
			expect(displays.term).toContain('"hello"');
			expect(displays.term).not.toContain('$k "hello"');
			expect(displays.constraints).toEqual(expect.arrayContaining([expect.stringMatching(/^String ~~ \?\d+$/)]));
			expect(displays.constraints).toEqual(expect.arrayContaining([expect.stringMatching(/^\?\d+ ~~ Num$/)]));
		});

		it("should record multiple resumptions on one bubble", () => {
			const src = "reset (shift ((resume 1) + (resume 2)))";
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term).toMatchObject({ type: "Block", return: { type: "Reset" } });
			expect(displays.term.match(/bubble#/g)).toHaveLength(1);
			expect(displays.term).toContain("FFI.$add");
			expect(displays.term).toContain("$k 1");
			expect(displays.term).toContain("$k 2");
			expect(displays.constraints).toEqual(expect.arrayContaining([expect.stringMatching(/^Num ~~ \?\d+$/)]));
		});

		it("should record independent bubbles for multiple shifts", () => {
			const src = "reset ((shift resume 10) + (shift resume 20))";
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term).toMatchObject({ type: "Block", return: { type: "Reset" } });
			expect(displays.term.match(/bubble#/g)).toHaveLength(2);
			expect(displays.term).toContain("FFI.$add");
			expect(displays.term).toContain("$k 10");
			expect(displays.term).toContain("$k 20");
		});

		it("should surface incompatible raw constraints for wrong continuation calls", () => {
			const src = "reset (1 + (shift resume true))";
			const { displays, structure } = elaborateFrom(src);

			expect(structure.term).toMatchObject({ type: "Block", return: { type: "Reset" } });
			expect(displays.term).toContain("bubble#");
			expect(displays.term).toContain("$k true");
			expect(displays.constraints).toEqual(expect.arrayContaining([expect.stringMatching(/^Bool ~~ \?\d+$/)]));
			expect(displays.constraints).toEqual(expect.arrayContaining([expect.stringMatching(/^\?\d+ ~~ Num$/)]));
		});
	});
});
