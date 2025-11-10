import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("inference: application", () => {
	it("simple application f x", () => {
		// f : Num -> Num is provided as a free var only if present in imports.
		// Here we'll just elaborate expression; constraints/meta will capture missing info.
		const res = elaborateFrom("(\\x -> x) 1");
		// Expect type to be Num after instantiation of the Pi
		expect(res.displays.type).toBe("?1");
		expect(res.displays.constraints.join()).toContain("Num ~~ ?1");
		expect({ displays: res.displays }).toMatchSnapshot();
		expect({ structure: res.structure }).toMatchSnapshot();
	});

	describe("implicit insertion", () => {
		it("inserts implicit argument when applying explicit arg to fn with implicit param", () => {
			// (\x => \y -> y) "hello"
			// Should elaborate to: (\x => \y -> y) @(?meta:Num) "hello"
			const res = elaborateFrom('(\\x => \\(y: String) -> y) "hello"');

			// The term should be an application with an implicit application inserted
			expect(res.structure.term).toMatchObject({
				type: "App",
				icit: "Explicit",
				func: { type: "App", icit: "Implicit" },
			});

			// The outer explicit application should wrap the implicit one
			const outerApp = res.structure.term;
			expect(outerApp.type).toBe("App");

			// Check that we have a meta for the implicit argument
			const metaEntries = Object.entries(res.structure.metas);
			expect(metaEntries.length).toBeGreaterThanOrEqual(1);

			// The displays should show the implicit application with @
			expect(res.displays.term).toContain("@");

			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("inserts implicit argument with correct type", () => {
			// (\x: Num => \y: String -> y) "hello"
			// Should insert @(?meta:Num)
			const res = elaborateFrom('(\\(x: Num) => \\(y: String) -> y) "hello"');

			expect(Object.entries(res.structure.metas)).toHaveLength(1);
			expect(res.displays.term).toContain("@?1");
			expect(res.structure.metas[1].ann).toMatchObject({ type: "Lit", value: { type: "Atom", value: "Num" } });

			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("inserts multiple implicit arguments when needed", () => {
			// (\a => \b => \c: String -> c) "hello"
			// Should insert @(?1) @(?2) "hello"
			const res = elaborateFrom('(\\a => \\b => \\(c: String) -> c) "hello"');

			const implicitCount = (res.displays.term.match(/@/g) || []).length;
			expect(implicitCount).toBe(2);

			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});
	});
});
