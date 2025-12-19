import { describe, expect, it } from "vitest";

import { elaborate } from "./utils";

describe("Shift-reset", () => {
	describe("resets without shifts", () => {
		it("handler calls continuation", () => {
			const src = `let test = reset 10 with \\k v -> k !`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			expect(structure).toMatchSnapshot();
		});

		it("handler ignores continuations", () => {
			const src = `let test = reset 10 with \\k v -> !`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			expect(structure).toMatchSnapshot();
		});
	});

	describe("shifts within resets", () => {
		describe("simple handler invoking continuation", () => {
			it("enclosed term is only a shift", () => {
				const src = `let test = reset (shift 42 \\x -> x) with \\k v -> k v`;

				const { pretty, structure } = elaborate(src);

				expect(pretty).toMatchSnapshot();
				expect(structure).toMatchSnapshot();
			});

			it("enclosed term is compound expression with shift", () => {
				const src = `let test = reset (1 + (shift 42 \\x -> x)) with \\k v -> k v`;

				const { pretty, structure } = elaborate(src);

				expect(pretty).toMatchSnapshot();
				expect(structure).toMatchSnapshot();
			});
		});
	});
});
