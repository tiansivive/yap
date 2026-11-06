import { describe, expect, it } from "vitest";
import { match } from "ts-pattern";
import { Build } from "../../../ivl/build";
import * as DSL from "../../../ivl/dsl";
import { Print } from "../../../ivl/print";
import { normalize } from "../normalize";

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

	describe("formulas as values", () => {
		const v = Build.const_("v", Build.Bool);

		it("splits an atom on the formula it contains", () => {
			const result = normalize(DSL.eq(v, Build.prop(DSL.gt(DSL.a, DSL.int(0)))));
			expect(Print.formula(result)).toBe("(or (and (> a 0) (= v true)) (and (not (> a 0)) (not (= v true))))");
		});

		it("states a boolean equal to false as the negation of it being true", () => {
			expect(Print.formula(normalize(DSL.eq(v, Build.bool(false))))).toBe("(not (= v true))");
			expect(Print.formula(normalize(DSL.neq(Build.bool(false), v)))).toBe("(= v true)");
		});

		it("folds a comparison between boolean literals", () => {
			expect(normalize(DSL.eq(Build.bool(true), Build.bool(false))).tag).toBe("False");
			expect(normalize(DSL.neq(Build.bool(true), Build.bool(false))).tag).toBe("True");
		});
	});
});
