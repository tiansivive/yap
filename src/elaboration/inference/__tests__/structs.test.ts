import { describe, it, expect } from "vitest";
import { elaborateFrom } from "./util";

describe("Inference: Structs", () => {
	it('multiple fields: { x: 1, y: "hello" }', () => {
		const { structure, displays } = elaborateFrom('{ x: 1, y: "hello" }');
		expect(displays.type).toMatch("Schema");
		expect(displays.type).toContain("x: Num");
		expect(displays.type).toContain("y: String");

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it('nested structs: { point: { x: 1, y: 2 }, label: "A" }', () => {
		const { structure, displays } = elaborateFrom('{ point: { x: 1, y: 2 }, label: "A" }');
		expect(displays.type).toMatch("Schema");
		expect(displays.type).toContain("point: Schema");
		expect(displays.type).toContain("x: Num");
		expect(displays.type).toContain("y: Num");
		expect(displays.type).toContain("label: String");

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	it('struct with computed field: { x: 1 + 2, y: "hello" }', () => {
		const { structure, displays } = elaborateFrom('{ x: 1 + 2, y: "hello" }');
		expect(displays.type).toMatch("Schema");
		expect(displays.type).toContain("x: Num");
		expect(displays.type).toContain("y: String");

		expect({ displays }).toMatchSnapshot();
		expect({ structure }).toMatchSnapshot();
	});

	describe("dependent structs", () => {
		it("fields depending on previous fields: { x: 1, y: :x + 2 }", () => {
			const { structure, displays } = elaborateFrom("{ x: 1, y: :x + 2 }");
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toContain("x: Num");
			expect(displays.type).toContain("y: Num");

			expect({ displays }).toMatchSnapshot();
			expect({ structure }).toMatchSnapshot();
		});

		it("nested dependent fields: { point: { x: 1, y: 2 }, halved: { a: :point.x / 2, b: :point.y / 2 } }", () => {
			const { structure, displays } = elaborateFrom("{ point: { x: 1, y: 2 }, halved: { a: :point.x / 2, b: :point.y / 2 } }");
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toContain("point: Schema");
			expect(displays.type).toContain("x: Num");
			expect(displays.type).toContain("y: Num");
			expect(displays.type).toContain("halved: Schema [ a: Num, b: Num ]");

			expect({ displays }).toMatchSnapshot();
			expect({ structure }).toMatchSnapshot();
		});

		it("dependent field referring to later field: { y: :x + 2, x: 1 }", () => {
			const { structure, displays } = elaborateFrom("{ y: :x + 2, x: 1 }");
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toContain("x: Num");
			expect(displays.type).toContain("y: Num");

			expect({ displays }).toMatchSnapshot();
			expect({ structure }).toMatchSnapshot();
		});

		it("mutually dependent fields: { a: :b + 1, b: :a + 1 }", () => {
			const { structure, displays } = elaborateFrom("{ a: :b + 1, b: :a + 1 }");
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toContain("a: Num");
			expect(displays.type).toContain("b: Num");

			expect({ displays }).toMatchSnapshot();
			expect({ structure }).toMatchSnapshot();
		});

		it('nested shadowing dependencies: { overriden: 1, foo: { inner: :overriden }, bar: { overriden: "hello", inner: :overriden }', () => {
			const { structure, displays } = elaborateFrom('{ overriden: 1, foo: { inner: :overriden }, bar: { overriden: "hello", inner: :overriden } }');
			expect(displays.type).toMatch("Schema");
			expect(displays.type).toContain("overriden: Num");
			expect(displays.type).toMatch(/foo: Schema \[ inner: \?\d+ \]/);
			expect(displays.type).toMatch(/bar: Schema \[ overriden: String, inner: \?\d+ \]/);
			expect(displays.constraints).toContain("Num ~~ ?2");
			expect(displays.constraints).toContain("String ~~ ?11");

			expect({ displays }).toMatchSnapshot();
			expect({ structure }).toMatchSnapshot();
		});
	});
});
