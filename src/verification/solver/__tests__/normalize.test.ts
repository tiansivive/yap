import { describe, it, expect } from "vitest";
import { match } from "ts-pattern";
import { normalize } from "../normalize";
import { Build } from "../ivl/build";
import * as DSL from "../ivl/dsl";

describe("normalize", () => {
	describe("trivial elimination", () => {
		it("removes True from conjunctions", () => {
			const result = normalize(DSL.and(DSL.T, DSL.eq(DSL.x, DSL.int(1))));
			expect(result.tag).toBe("Atom");
		});

		it("reduces And of all True to True", () => {
			expect(normalize(DSL.and(DSL.T, DSL.T)).tag).toBe("True");
		});

		it("reduces And containing False to False", () => {
			expect(normalize(DSL.and(DSL.T, DSL.F)).tag).toBe("False");
		});

		it("removes False from disjunctions", () => {
			const result = normalize(DSL.or(DSL.F, DSL.gt(DSL.x, DSL.int(0))));
			expect(result.tag).toBe("Atom");
		});

		it("reduces Or containing True to True", () => {
			expect(normalize(DSL.or(DSL.F, DSL.T)).tag).toBe("True");
		});
	});

	describe("double negation", () => {
		it("eliminates Not(Not(f))", () => {
			const result = normalize(DSL.not(DSL.not(DSL.eq(DSL.x, DSL.int(0)))));
			expect(result.tag).toBe("Atom");
		});

		it("simplifies Not(True) to False", () => {
			expect(normalize(DSL.not(DSL.T)).tag).toBe("False");
		});

		it("simplifies Not(False) to True", () => {
			expect(normalize(DSL.not(DSL.F)).tag).toBe("True");
		});
	});

	describe("implication simplification", () => {
		it("simplifies False => anything to True", () => {
			expect(normalize(DSL.implies(DSL.F, DSL.eq(DSL.x, DSL.int(1)))).tag).toBe("True");
		});

		it("simplifies True => body to body", () => {
			const result = normalize(DSL.implies(DSL.T, DSL.gt(DSL.x, DSL.int(0))));
			expect(result.tag).toBe("Atom");
		});

		it("simplifies anything => True to True", () => {
			expect(normalize(DSL.implies(DSL.eq(DSL.x, DSL.int(1)), DSL.T)).tag).toBe("True");
		});
	});

	describe("ground arithmetic folding", () => {
		it("folds constant addition", () => {
			const result = normalize(DSL.eq(DSL.add(DSL.int(2), DSL.int(3)), DSL.int(5)));
			expect(result.tag).toBe("True");
		});
	});

	describe("flattening", () => {
		it("flattens nested And", () => {
			const result = normalize(DSL.and(DSL.and(DSL.eq(DSL.a, DSL.int(1))), DSL.eq(DSL.b, DSL.int(2))));
			expect(result.tag).toBe("And");
			match(result)
				.with({ tag: "And" }, ({ values }) => {
					expect(values).toHaveLength(2);
					expect(values.every(v => v.tag === "Atom")).toBe(true);
				})
				.otherwise(() => {});
		});
	});
});
