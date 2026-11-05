import { describe, expect, it } from "vitest";

import { elaborate } from "./utils";

describe("Shift-reset", () => {
	describe("resets without captures", () => {
		it("literal value", () => {
			const src = `let test = reset 10`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});
	});

	describe("only one capture within reset", () => {
		it("invoking id continuation", () => {
			const src = `let test = reset (capture (\\k -> k "hello"))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("not invoking continuation", () => {
			const src = `let test = reset (capture (\\k -> "world"))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("invoking simple continuation with proper value", () => {
			const src = `let test = reset (1 + (capture (\\k -> k 1)))`;

			const { pretty, structure } = elaborate(src);
			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("overriding continuation return type", () => {
			const src = `let test = reset (1 + (capture (\\k -> "hello")))`;

			const { pretty, structure } = elaborate(src);
			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("calling continuation with incorrect type", () => {
			const src = `let test = reset (1 + (capture (\\k -> k true)))`;

			expect(() => elaborate(src)).toThrow("Unification Failure: Cannot unify Bool with Num");
		});

		it("multiple resumptions", () => {
			const src = `let test = reset (capture (\\k -> (k 1) + (k 2)))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("nested resumption", () => {
			const src = `let test = reset (capture (\\k -> k (k 10)))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("nested resumption with non-id continuation", () => {
			const src = `let test = reset (1 + (capture (\\k -> k (k 10))))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});
	});

	describe("multiple captures within reset", () => {
		it("invoking continuations", () => {
			const src = `let test = reset ((capture (\\k -> k 10)) + (capture (\\k -> k 20)))`;

			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});

		it("multiple captures and multiple resumptions", () => {
			const src = `let test = reset (4 + (capture (\\k -> k 3)) + (capture (\\k -> k 2)) + (capture (\\k -> k (k 1))))`;
			const { pretty, structure } = elaborate(src);

			expect(pretty).toMatchSnapshot();
			//expect(structure).toMatchSnapshot();
		});
	});

	describe("resumption of dependent continuation", () => {
		// TODO(dependent-match-implication-constraints): remove `.fails` once wildcard arms carry preceding-pattern exclusions.
		it.fails("resuming continuation with dependent type", () => {
			const src = /* fs */ `let test = {

				let f: (x: Num) -> (match x | 0 -> Num | _ -> String)
					 = \\x -> match x | 0 -> 0 | _ -> "hello"; 
				
				let foo = reset (f (capture (\\k -> k 10)));
			}`;

			expect(() => elaborate(src)).not.toThrow();
		});

		it.fails("multiple resumes with incompatible dependent types", () => {
			const src = `let test = {
				let f: (x: Num) -> (match x | 0 -> Num | _ -> String)
					 = \\x -> match x | 0 -> 0 | _ -> "hello"; 
				
				let foo = reset (f (capture (\\k -> (k 0) + (k 10))));
			}`;

			expect(() => elaborate(src)).toThrow("Cannot unify String with Num");
		});
	});
});
