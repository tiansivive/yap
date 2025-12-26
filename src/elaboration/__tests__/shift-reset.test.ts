import { describe, expect, it } from "vitest";

import { elaborate } from "./utils";

describe("Shift-reset", () => {
	describe("resets without shifts", () => {
		it("literal value", () => {
			const src = `let test = reset 10`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});
	});

	describe("only one shift within reset", () => {
		it("invoking id continuation", () => {
			const src = `let test = reset (shift (resume "hello"))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("not invoking continuation", () => {
			const src = `let test = reset (shift "world")`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("invoking simple continuation with proper value", () => {
			const src = `let test = reset (1 + (shift resume 1))`;

			const { pretty, structure } = elaborate(src);
			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("overriding continuation return type", () => {
			const src = `let test = reset (1 + (shift "hello"))`;

			const { pretty, structure } = elaborate(src);
			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("calling continuation with incorrect type", () => {
			const src = `let test = reset (1 + (shift resume true))`;

			expect(() => elaborate(src)).toThrow("Unification Failure: Cannot unify Bool with Num");
		});

		it("multiple resumptions", () => {
			const src = `let test = reset (shift ((resume 1) + (resume 2)))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("nested resumption", () => {
			const src = `let test = reset (shift (resume (resume 10)))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("nested resumption with non-id continuation", () => {
			const src = `let test = reset (1 + (shift (resume (resume 10))))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});
	});

	describe("multiple shifts within reset", () => {
		it("invoking continuations", () => {
			const src = `let test = reset ((shift resume 10) + (shift resume 20))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("multiple shifts and multiple resumptions", () => {
			const src = `let test = reset (4 + (shift resume 3) + (shift resume 2) + (shift resume (resume 1)))`;
			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});
	});

	describe.skip("resumption of dependent continuation", () => {});
});
