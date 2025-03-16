import { describe, it, expect } from "vitest";

import * as EB from "@qtt/elaboration";
import * as Lit from "@qtt/shared/literals";

describe("Displaying elaborated terms", () => {
	describe("Literals", () => {
		it("should display a number", () => {
			const term = EB.Constructors.Lit(Lit.Num(1));
			expect(EB.Display.Term(term)).toBe("1");
		});

		it("should display a string", () => {
			const term = EB.Constructors.Lit(Lit.String("hello"));
			expect(EB.Display.Term(term)).toBe('"hello"');
		});

		it.skip("should display a boolean", () => {
			const term = EB.Constructors.Lit(Lit.Bool(true));
			expect(EB.Display.Term(term)).toBe("true");
		});

		it("should display a unit", () => {
			const term = EB.Constructors.Lit(Lit.Unit());
			expect(EB.Display.Term(term)).toBe("Unit");
		});

		it("should display a Type", () => {
			const term = EB.Constructors.Lit(Lit.Type());
			expect(EB.Display.Term(term)).toBe("Type");
		});

		it("should display an atom", () => {
			const term = EB.Constructors.Lit(Lit.Atom("TestAtom"));
			expect(EB.Display.Term(term)).toBe("TestAtom");
		});
	});

	describe("Variables", () => {
		it("should display a free variable", () => {
			const term = EB.Constructors.Var(EB.Free("x"));
			expect(EB.Display.Term(term)).toBe("x");
		});

		it("should display a meta variable", () => {
			const term = EB.Constructors.Var(EB.Meta(1, 0));
			expect(EB.Display.Term(term)).toBe("?1");
		});

		it("should display a bound variable", () => {
			const term = EB.Constructors.Var(EB.Bound(1));
			expect(EB.Display.Term(term)).toBe("i1");
		});
	});

	describe("Abstractions", () => {
		it("should display a lambda", () => {
			const term = EB.Constructors.Lambda("x", "Explicit", EB.Constructors.Var(EB.Bound(0)));
			expect(EB.Display.Term(term)).toBe("λx -> i0");
		});

		it("should display an implicit lambda", () => {
			const term = EB.Constructors.Lambda("x", "Implicit", EB.Constructors.Var(EB.Bound(0)));
			expect(EB.Display.Term(term)).toBe("λx => i0");
		});

		it("should display a pi", () => {
			const annotation = EB.Constructors.Lit(Lit.Atom("Int"));
			const outType = EB.Constructors.Lit(Lit.Atom("Bool"));
			const term = EB.Constructors.Pi("x", "Explicit", "One", annotation, outType);
			expect(EB.Display.Term(term)).toBe("Π(<1> x: Int) -> Bool");
		});

		it("should display an implicit pi", () => {
			const annotation = EB.Constructors.Lit(Lit.Atom("Int"));
			const outType = EB.Constructors.Lit(Lit.Atom("Bool"));
			const term = EB.Constructors.Pi("x", "Implicit", "One", annotation, outType);
			expect(EB.Display.Term(term)).toBe("Π(<1> x: Int) => Bool");
		});
	});

	describe("Applications", () => {
		it("should display an application", () => {
			const term = EB.Constructors.App("Explicit", EB.Constructors.Var(EB.Bound(0)), EB.Constructors.Var(EB.Bound(1)));
			expect(EB.Display.Term(term)).toBe("i0 i1");
		});

		it("should display an implicit application", () => {
			const term = EB.Constructors.App("Implicit", EB.Constructors.Var(EB.Bound(0)), EB.Constructors.Var(EB.Bound(1)));
			expect(EB.Display.Term(term)).toBe("i0 @i1");
		});
	});

	describe("Annotations", () => {
		it("should display an annotation", () => {
			const term = EB.Constructors.Annotation(EB.Constructors.Var(EB.Bound(0)), EB.Constructors.Lit(Lit.Atom("Int")));
			expect(EB.Display.Term(term)).toBe("i0 : Int");
		});

		it.skip("should display a nested annotation", () => {
			const term = EB.Constructors.Annotation(
				EB.Constructors.Var(EB.Bound(0)),
				EB.Constructors.Annotation(EB.Constructors.Var(EB.Bound(1)), EB.Constructors.Lit(Lit.Atom("Int"))),
			);
			expect(EB.Display.Term(term)).toBe("i0 : (i1 : Int)");
		});
	});

	describe("Row terms", () => {
		describe("Literal rows", () => {
			it("should display an empty row", () => {
				const term = EB.Constructors.Row({ type: "empty" });
				expect(EB.Display.Term(term)).toBe("[]");
			});

			it("should display a row with a single field", () => {
				const term = EB.Constructors.Row({
					type: "extension",
					label: "x",
					value: EB.Constructors.Var(EB.Bound(0)),
					row: { type: "empty" },
				});
				expect(EB.Display.Term(term)).toBe("[ x: i0 ]");
			});

			it("should display a row with multiple fields", () => {
				const term = EB.Constructors.Row({
					type: "extension",
					label: "x",
					value: EB.Constructors.Var(EB.Bound(0)),
					row: {
						type: "extension",
						label: "y",
						value: EB.Constructors.Var(EB.Bound(1)),
						row: { type: "empty" },
					},
				});
				expect(EB.Display.Term(term)).toBe("[ x: i0, y: i1 ]");
			});

			it("should display a row with a variable", () => {
				const term = EB.Constructors.Row({ type: "variable", variable: EB.Free("r") });
				expect(EB.Display.Term(term)).toBe("[ | r ]");
			});

			it("should display a row with a variable and an extension", () => {
				const term = EB.Constructors.Row({
					type: "extension",
					label: "x",
					value: EB.Constructors.Var(EB.Bound(0)),
					row: { type: "variable", variable: EB.Free("r") },
				});
				expect(EB.Display.Term(term)).toBe("[ x: i0 | r ]");
			});
		});

		describe("Structs", () => {
			it("should display an empty struct", () => {
				const term = EB.Constructors.Struct({ type: "empty" });
				expect(EB.Display.Term(term)).toBe("Struct []");
			});

			it("should display a struct with a single field", () => {
				const term = EB.Constructors.Struct({
					type: "extension",
					label: "x",
					value: EB.Constructors.Var(EB.Bound(0)),
					row: { type: "empty" },
				});
				expect(EB.Display.Term(term)).toBe("Struct [ x: i0 ]");
			});

			it("should display a struct with multiple fields", () => {
				const term = EB.Constructors.Struct({
					type: "extension",
					label: "x",
					value: EB.Constructors.Var(EB.Bound(0)),
					row: {
						type: "extension",
						label: "y",
						value: EB.Constructors.Var(EB.Bound(1)),
						row: { type: "empty" },
					},
				});
				expect(EB.Display.Term(term)).toBe("Struct [ x: i0, y: i1 ]");
			});

			it("should display a struct with a variable and an extension", () => {
				const term = EB.Constructors.Struct({
					type: "extension",
					label: "x",
					value: EB.Constructors.Var(EB.Bound(0)),
					row: { type: "variable", variable: EB.Free("r") },
				});
				expect(EB.Display.Term(term)).toBe("Struct [ x: i0 | r ]");
			});
		});
	});
});
