import { describe, it, expect } from "vitest";
import { Field, Liquid, TypeText, elaborateFrom } from "./util";

describe("Inference: Structs", () => {
	it('multiple fields: { x: 1, y: "hello" }', () => {
		const { displays } = elaborateFrom('{ x: 1, y: "hello" }');
		expect(displays.type).toMatch("Schema");
		expect(displays.type).toMatch(Field.bare("x", TypeText.lit("Num")));
		expect(displays.type).toMatch(Field.bare("y", TypeText.lit("String")));

		expect({ displays }).toMatchSnapshot();
	});

	it('nested structs: { point: { x: 1, y: 2 }, label: "A" }', () => {
		const { displays } = elaborateFrom('{ point: { x: 1, y: 2 }, label: "A" }');
		expect(displays.type).toMatch("Schema");
		expect(displays.type).toMatch(Field.schema("point"));
		expect(displays.type).toMatch(Field.bare("x", TypeText.lit("Num")));
		expect(displays.type).toMatch(Field.bare("y", TypeText.lit("Num")));
		expect(displays.type).toMatch(Field.bare("label", TypeText.lit("String")));

		expect({ displays }).toMatchSnapshot();
	});

	it('struct with computed field: { x: 1 + 2, y: "hello" }', () => {
		const { displays } = elaborateFrom('{ x: 1 + 2, y: "hello" }');
		expect(displays.type).toMatch("Schema");
		expect(displays.type).toMatch(Field.modal("x", TypeText.lit("Num")));
		expect(displays.type).toMatch(Liquid.mentions("FFI.$add"));
		expect(displays.type).toMatch(Field.bare("y", TypeText.lit("String")));

		expect({ displays }).toMatchSnapshot();
	});

	describe("dependent structs", () => {
		it("fields depending on previous fields: { x: 1, y: :x + 2 }", () => {
			const { displays } = elaborateFrom("{ x: 1, y: :x + 2 }");
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toMatch(Field.bare("x", TypeText.lit("Num")));
			expect(displays.type).toMatch(Field.modal("y", TypeText.lit("Num")));
			expect(displays.type).toMatch(Liquid.mentions("FFI.$add"));

			expect({ displays }).toMatchSnapshot();
		});

		it("nested dependent fields: { point: { x: 1, y: 2 }, halved: { a: :point.x / 2, b: :point.y / 2 } }", () => {
			const { displays } = elaborateFrom("{ point: { x: 1, y: 2 }, halved: { a: :point.x / 2, b: :point.y / 2 } }");
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toMatch(Field.schema("point"));
			expect(displays.type).toMatch(Field.bare("x", TypeText.lit("Num")));
			expect(displays.type).toMatch(Field.bare("y", TypeText.lit("Num")));
			expect(displays.type).toMatch(Field.schema("halved"));
			expect(displays.type).toMatch(Field.modal("a", TypeText.lit("Num")));
			expect(displays.type).toMatch(Field.modal("b", TypeText.lit("Num")));
			expect(displays.type).toMatch(Liquid.mentions("FFI.$div"));

			expect({ displays }).toMatchSnapshot();
		});

		it("dependent field referring to later field: { y: :x + 2, x: 1 }", () => {
			const { displays } = elaborateFrom("{ y: :x + 2, x: 1 }");
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toMatch(Field.bare("x", TypeText.lit("Num")));
			expect(displays.type).toMatch(Field.modal("y", TypeText.lit("Num")));
			expect(displays.type).toMatch(Liquid.mentions("FFI.$add"));

			expect({ displays }).toMatchSnapshot();
		});

		it("mutually dependent fields: { a: :b + 1, b: :a + 1 }", () => {
			const { displays } = elaborateFrom("{ a: :b + 1, b: :a + 1 }");
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toMatch(Field.modal("a", TypeText.lit("Num")));
			expect(displays.type).toMatch(Field.modal("b", TypeText.lit("Num")));
			expect(displays.type).toMatch(Liquid.mentions("FFI.$add"));

			expect({ displays }).toMatchSnapshot();
		});

		it('nested shadowing dependencies: { overriden: 1, foo: { inner: :overriden }, bar: { overriden: "hello", inner: :overriden }', () => {
			const { displays } = elaborateFrom('{ overriden: 1, foo: { inner: :overriden }, bar: { overriden: "hello", inner: :overriden } }');
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toMatch(Field.bare("overriden", TypeText.lit("Num")));
			expect(displays.type).toMatch(Field.schema("foo", Field.meta("inner")));
			expect(displays.type).toMatch(Field.schema("bar", Field.bare("overriden", TypeText.lit("String")), Field.meta("inner")));
			expect(displays.constraints).toContain("Num ~~ ?1");
			expect(displays.constraints).toContain("String ~~ ?4");

			expect({ displays }).toMatchSnapshot();
		});
	});
});
