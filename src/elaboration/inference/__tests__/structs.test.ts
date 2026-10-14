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
		it("rejects an unknown Nu label", () => {
			expect(() => elaborateFrom("{ a: 1, b: $nope }")).toThrow("No enclosing record field named nope");
		});

		it("fields depending on previous fields: { x: 1, y: $x + 2 }", () => {
			const { displays } = elaborateFrom("{ x: 1, y: $x + 2 }");
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toMatch(Field.bare("x", TypeText.lit("Num")));
			expect(displays.type).toMatch(Field.modal("y", TypeText.lit("Num")));
			expect(displays.type).toMatch(Liquid.mentions("FFI.$add"));

			expect({ displays }).toMatchSnapshot();
		});

		it("nested dependent fields: { point: { x: 1, y: 2 }, halved: { a: $point.x / 2, b: $point.y / 2 } }", () => {
			const { displays } = elaborateFrom("{ point: { x: 1, y: 2 }, halved: { a: $point.x / 2, b: $point.y / 2 } }");
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

		it("dependent field referring to later field: { y: $x + 2, x: 1 }", () => {
			const { displays } = elaborateFrom("{ y: $x + 2, x: 1 }");
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toMatch(Field.bare("x", TypeText.lit("Num")));
			expect(displays.type).toMatch(Field.modal("y", TypeText.lit("Num")));
			expect(displays.type).toMatch(Liquid.mentions("FFI.$add"));

			expect({ displays }).toMatchSnapshot();
		});

		it("rejects mutually dependent fields: { a: $b + 1, b: $a + 1 }", () => {
			expect(() => elaborateFrom("{ a: $b + 1, b: $a + 1 }")).toThrow("Record Cycle: fields $a -> $b -> $a");
		});

		it("rejects a field reading itself: { a: { x: $a } }", () => {
			expect(() => elaborateFrom("{ a: { x: $a } }")).toThrow("Record Cycle: fields $a -> $a");
		});

		it("rejects calling a field during construction: { f: \\x -> x, g: $f 1 }", () => {
			expect(() => elaborateFrom("{ f: \\x -> x, g: $f 1 }")).toThrow("Record Call: $f");
		});

		it("accepts a field read under a lambda: { f: \\x -> $g, g: 1 }", () => {
			const { displays } = elaborateFrom("{ f: \\x -> $g, g: 1 }");
			expect(displays.term).toMatch("νstrict [ g: 1 ]");
		});

		it('nested shadowing dependencies: { overriden: 1, foo: { inner: $overriden }, bar: { overriden: "hello", inner: $overriden }', () => {
			const { displays } = elaborateFrom('{ overriden: 1, foo: { inner: $overriden }, bar: { overriden: "hello", inner: $overriden } }');
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toMatch(Field.bare("overriden", TypeText.lit("Num")));
			expect(displays.type).toMatch(Field.schema("foo", Field.meta("inner")));
			expect(displays.type).toMatch(Field.schema("bar", Field.bare("overriden", TypeText.lit("String")), Field.meta("inner")));

			const fooInner = displays.type.match(/\bfoo:\s+Schema\s+\[\s*inner:\s+(\?\d+)\s*\]/)?.[1];
			const barInner = displays.type.match(/\bbar:\s+Schema\s+\[\s*overriden:\s+String,\s+inner:\s+(\?\d+)\s*\]/)?.[1];
			expect(fooInner).toMatch(/^\?\d+$/);
			expect(barInner).toMatch(/^\?\d+$/);
			expect(displays.constraints).toContain(`Num ~~ ${fooInner}`);
			expect(displays.constraints).toContain(`String ~~ ${barInner}`);

			expect({ displays }).toMatchSnapshot();
		});
	});
});
