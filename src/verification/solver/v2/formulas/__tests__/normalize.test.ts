import assert from "node:assert";
import { describe, expect, it } from "vitest";
import { match } from "ts-pattern";
import * as DSL from "../../../ivl/dsl";
import { Build } from "../../../ivl/build";
import type { IVL } from "../../../ivl/types";
import { extract } from "../../quantifier/triggers";
import { normalize } from "../normalize";

describe("normalize", () => {
	it("preserves applications with many ordinary arguments", () => {
		const args = Array.from({ length: 3000 }, (_, i) => DSL.int(i));
		const formula = DSL.eq(Build.app("f", args, Build.Int), DSL.int(0));
		expect(normalize(formula)).toEqual(formula);
	});

	describe("Boolean values", () => {
		const v = Build.const_("v", Build.Bool);
		const condition = DSL.gt(DSL.a, DSL.int(0));

		it.each([true, false])("folds equality and inequality with literal %s", left => {
			[true, false].forEach(right => {
				expect(normalize(DSL.eq(Build.bool(left), Build.bool(right)))).toEqual(left === right ? Build.true_() : Build.false_());
				expect(normalize(DSL.neq(Build.bool(left), Build.bool(right)))).toEqual(left !== right ? Build.true_() : Build.false_());
			});
		});

		it.each([true, false])("normalizes equality and inequality with %s on either side", value => {
			const truth = DSL.eq(v, Build.bool(true));
			const literal = Build.bool(value);
			[
				[v, literal],
				[literal, v],
			].forEach(([left, right]) => {
				expect(normalize(DSL.eq(left, right))).toEqual(value ? truth : Build.not(truth));
				expect(normalize(DSL.neq(left, right))).toEqual(value ? Build.not(truth) : truth);
			});
		});

		it("splits a comparison value into its true and false cases", () => {
			expect(normalize(DSL.eq(v, Build.prop(condition)))).toEqual(
				Build.or(Build.and(condition, DSL.eq(v, Build.bool(true))), Build.and(Build.not(condition), Build.not(DSL.eq(v, Build.bool(true))))),
			);
		});

		it.each([
			{ name: "first application argument", wrap: (t: IVL.Term) => Build.app("f", [t, Build.bool(false)], Build.Int) },
			{ name: "later application argument", wrap: (t: IVL.Term) => Build.app("f", [Build.bool(false), t], Build.Int) },
			{ name: "selection index", wrap: (t: IVL.Term) => Build.select(Build.const_("f", Build.fn([Build.Bool], Build.Int)), t, Build.Int) },
			{ name: "selection source", wrap: (t: IVL.Term) => Build.select(Build.app("f", [t], Build.fn([Build.Int], Build.Int)), DSL.int(0), Build.Int) },
			{ name: "left arithmetic operand", wrap: (t: IVL.Term) => DSL.add(Build.app("f", [t], Build.Int), DSL.int(1)) },
			{ name: "right arithmetic operand", wrap: (t: IVL.Term) => DSL.add(DSL.int(1), Build.app("f", [t], Build.Int)) },
			{ name: "row field", wrap: (t: IVL.Term) => Build.row(Build.rowExtend("flag", t, Build.rowVar("tail")), Build.Row) },
			{
				name: "later row field",
				wrap: (t: IVL.Term) => Build.row(Build.rowExtend("first", DSL.int(0), Build.rowExtend("flag", t, Build.rowEmpty)), Build.Row),
			},
			{
				name: "nested row field",
				wrap: (t: IVL.Term) =>
					Build.row(Build.rowExtend("nested", Build.row(Build.rowExtend("flag", t, Build.rowEmpty), Build.Row), Build.rowEmpty), Build.Row),
			},
		])("lifts a value from a $name", ({ wrap }) => {
			const wrapped = wrap(Build.bool(true));
			assert("sort" in wrapped);
			const result = Build.const_("result", wrapped.sort);
			expect(normalize(DSL.eq(wrap(Build.prop(condition)), result))).toEqual(
				Build.or(Build.and(condition, DSL.eq(wrap(Build.bool(true)), result)), Build.and(Build.not(condition), DSL.eq(wrap(Build.bool(false)), result))),
			);
		});

		it("preserves nested universal and existential scopes", () => {
			const outer = [{ name: "x", sort: Build.Int }];
			const inner = [{ name: "y", sort: Build.Int }];
			const relation = DSL.gt(DSL.x, DSL.y);
			const formula = Build.forall(outer, Build.exists(inner, DSL.eq(v, Build.prop(relation))));
			expect(normalize(formula)).toEqual(
				Build.forall(
					outer,
					Build.exists(
						inner,
						Build.or(Build.and(relation, DSL.eq(v, Build.bool(true))), Build.and(Build.not(relation), Build.not(DSL.eq(v, Build.bool(true))))),
					),
				),
			);
		});

		it("retains complete safe trigger groups", () => {
			const safe = Build.app("f", [DSL.x], Build.Int);
			const unsafe = Build.app("g", [Build.prop(DSL.gt(DSL.x, DSL.int(0)))], Build.Int);
			const formula = Build.forall([{ name: "x", sort: Build.Int }], DSL.eq(safe, DSL.int(0)), undefined, [{ terms: [safe, unsafe] }, { terms: [safe] }]);
			expect(normalize(formula)).toEqual(Build.forall([{ name: "x", sort: Build.Int }], DSL.eq(safe, DSL.int(0)), undefined, [{ terms: [safe] }]));
		});

		it("infers triggers when all supplied groups contain formula values", () => {
			const safe = Build.app("f", [DSL.x], Build.Int);
			const unsafe = Build.row(Build.rowExtend("flag", Build.prop(DSL.gt(DSL.x, DSL.int(0))), Build.rowEmpty), Build.Row);
			const formula = Build.forall([{ name: "x", sort: Build.Int }], DSL.eq(safe, DSL.int(0)), undefined, [{ terms: [unsafe] }]);
			expect(normalize(formula)).toEqual(Build.forall([{ name: "x", sort: Build.Int }], DSL.eq(safe, DSL.int(0))));
			expect(extract(normalize(formula))[0].triggers).toEqual([{ terms: [safe], boundVars: ["x"] }]);
		});
	});

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
