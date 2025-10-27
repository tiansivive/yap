import { describe, it, expect, beforeAll } from "vitest";

import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as Lib from "@yap/shared/lib/primitives";

let ctx: EB.Context;
beforeAll(() => {
	ctx = Lib.defaultContext();
});

describe("Displaying elaborated terms", () => {
	describe("Literals", () => {
		it("should display a number", () => {
			const term = EB.Constructors.Lit(Lit.Num(1));
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});

		it("should display a string", () => {
			const term = EB.Constructors.Lit(Lit.String("hello"));
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});

		it("should display a boolean", () => {
			const term = EB.Constructors.Lit(Lit.Bool(true));
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});

		it("should display a unit", () => {
			const term = EB.Constructors.Lit(Lit.Unit());
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});

		it("should display a Type", () => {
			const term = EB.Constructors.Lit(Lit.Type());
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});

		it("should display an atom", () => {
			const term = EB.Constructors.Lit(Lit.Atom("TestAtom"));
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});
	});

	describe("Variables", () => {
		it("should display a free variable", () => {
			const term = EB.Constructors.Var(EB.Free("x"));
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});

		it("should display a meta variable", () => {
			const m = EB.Meta(1, 0);
			const term = EB.Constructors.Var(m);

			const xtended: EB.Context = { ...ctx, metas: { 1: { meta: m, ann: EB.NF.Type } } };
			expect(EB.Display.Term(term, xtended)).toMatchSnapshot();
		});

		it("should display a bound variable", () => {
			const term = EB.Constructors.Var(EB.Bound(1));
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});
	});

	describe("Abstractions", () => {
		it("should display a lambda", () => {
			const term = EB.Constructors.Lambda("x", "Explicit", EB.Constructors.Var(EB.Bound(0)), EB.Constructors.Lit(Lit.Atom("Any")));
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});

		it("should display an implicit lambda", () => {
			const term = EB.Constructors.Lambda("x", "Implicit", EB.Constructors.Var(EB.Bound(0)), EB.Constructors.Lit(Lit.Atom("Any")));
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});

		it("should display a pi", () => {
			const annotation = EB.Constructors.Lit(Lit.Atom("Int"));
			const outType = EB.Constructors.Lit(Lit.Atom("Bool"));
			const term = EB.Constructors.Pi("x", "Explicit", annotation, outType);
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});

		it("should display an implicit pi", () => {
			const annotation = EB.Constructors.Lit(Lit.Atom("Int"));
			const outType = EB.Constructors.Lit(Lit.Atom("Bool"));
			const term = EB.Constructors.Pi("x", "Implicit", annotation, outType);
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});
	});

	describe("Applications", () => {
		it("should display an application", () => {
			const term = EB.Constructors.App("Explicit", EB.Constructors.Var(EB.Bound(0)), EB.Constructors.Var(EB.Bound(1)));
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});

		it("should display an implicit application", () => {
			const term = EB.Constructors.App("Implicit", EB.Constructors.Var(EB.Bound(0)), EB.Constructors.Var(EB.Bound(1)));
			expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
		});
	});

	// No Annotation constructor exists currently; skipping annotation-specific tests.

	describe("Row terms", () => {
		describe("Literal rows", () => {
			it("should display an empty row", () => {
				const term = EB.Constructors.Row({ type: "empty" });
				expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
			});

			it("should display a row with a single field", () => {
				const term = EB.Constructors.Row({
					type: "extension",
					label: "x",
					value: EB.Constructors.Var(EB.Bound(0)),
					row: { type: "empty" },
				});
				expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
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
				expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
			});

			it("should display a row with a variable", () => {
				const term = EB.Constructors.Row({ type: "variable", variable: EB.Free("r") });
				expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
			});

			it("should display a row with a variable and an extension", () => {
				const term = EB.Constructors.Row({
					type: "extension",
					label: "x",
					value: EB.Constructors.Var(EB.Bound(0)),
					row: { type: "variable", variable: EB.Free("r") },
				});
				expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
			});
		});

		describe("Structs", () => {
			it("should display an empty struct", () => {
				const term = EB.Constructors.Struct({ type: "empty" });
				expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
			});

			it("should display a struct with a single field", () => {
				const term = EB.Constructors.Struct({
					type: "extension",
					label: "x",
					value: EB.Constructors.Var(EB.Bound(0)),
					row: { type: "empty" },
				});
				expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
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
				expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
			});

			it("should display a struct with a variable and an extension", () => {
				const term = EB.Constructors.Struct({
					type: "extension",
					label: "x",
					value: EB.Constructors.Var(EB.Bound(0)),
					row: { type: "variable", variable: EB.Free("r") },
				});
				expect(EB.Display.Term(term, ctx)).toMatchSnapshot();
			});
		});
	});
});
