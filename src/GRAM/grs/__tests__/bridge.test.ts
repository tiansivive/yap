import { describe, it, expect, beforeEach } from "vitest";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as Lit from "@yap/shared/literals";

import * as Bridge from "../bridge";

beforeEach(() => {
	NF.resetId();
});

describe("toJson", () => {
	it("converts Num literal", () => {
		const nf = NF.Constructors.Lit(Lit.Num(42));
		expect(Bridge.toJson(nf)).toBe(42);
	});

	it("converts Bool literal", () => {
		const nf = NF.Constructors.Lit(Lit.Bool(true));
		expect(Bridge.toJson(nf)).toBe(true);
	});

	it("converts String literal", () => {
		const nf = NF.Constructors.Lit(Lit.String("hello"));
		expect(Bridge.toJson(nf)).toBe("hello");
	});

	it("converts Atom literal", () => {
		const nf = NF.Constructors.Lit(Lit.Atom("MyAtom"));
		expect(Bridge.toJson(nf)).toBe("MyAtom");
	});

	it("converts unit to null", () => {
		const nf = NF.Constructors.Lit(Lit.unit());
		expect(Bridge.toJson(nf)).toBe(null);
	});

	it("converts empty row to empty object", () => {
		const nf = NF.Constructors.Row(R.Constructors.Empty());
		expect(Bridge.toJson(nf)).toEqual({});
	});

	it("converts row extension to object", () => {
		const row = R.Constructors.Extension("x", NF.Constructors.Lit(Lit.Num(1)), R.Constructors.Empty<NF.Value, NF.Variable>());
		const nf = NF.Constructors.Row(row);
		expect(Bridge.toJson(nf)).toEqual({ x: 1 });
	});

	it("converts nested row to nested object", () => {
		const inner = R.Constructors.Extension("a", NF.Constructors.Lit(Lit.Num(1)), R.Constructors.Empty<NF.Value, NF.Variable>());
		const outer = R.Constructors.Extension("nested", NF.Constructors.Row(inner), R.Constructors.Empty<NF.Value, NF.Variable>());
		const nf = NF.Constructors.Row(outer);
		expect(Bridge.toJson(nf)).toEqual({ nested: { a: 1 } });
	});

	it("converts Schema[row] to object", () => {
		const row = R.Constructors.Extension("field", NF.Constructors.Lit(Lit.String("value")), R.Constructors.Empty<NF.Value, NF.Variable>());
		const nf = NF.Constructors.App(NF.Constructors.Lit(Lit.Atom("Schema")), NF.Constructors.Row(row), "Explicit");
		expect(Bridge.toJson(nf)).toEqual({ field: "value" });
	});

	it("converts Array[row] to array", () => {
		const row = R.Constructors.Extension(
			"0",
			NF.Constructors.Lit(Lit.Num(1)),
			R.Constructors.Extension("1", NF.Constructors.Lit(Lit.Num(2)), R.Constructors.Empty<NF.Value, NF.Variable>()),
		);
		const nf = NF.Constructors.App(NF.Constructors.Lit(Lit.Atom("Array")), NF.Constructors.Row(row), "Explicit");
		expect(Bridge.toJson(nf)).toEqual([1, 2]);
	});
});

describe("fromJson", () => {
	it("converts number to Num literal", () => {
		const nf = Bridge.fromJson(42);
		expect(nf.type).toBe("Lit");
		expect((nf as NF.Value & { type: "Lit" }).value).toEqual({ type: "Num", value: 42 });
	});

	it("converts boolean to Bool literal", () => {
		const nf = Bridge.fromJson(true);
		expect(nf.type).toBe("Lit");
		expect((nf as NF.Value & { type: "Lit" }).value).toEqual({ type: "Bool", value: true });
	});

	it("converts string to String literal", () => {
		const nf = Bridge.fromJson("hello");
		expect(nf.type).toBe("Lit");
		expect((nf as NF.Value & { type: "Lit" }).value).toEqual({ type: "String", value: "hello" });
	});

	it("converts null to Unit literal", () => {
		const nf = Bridge.fromJson(null);
		expect(nf.type).toBe("Lit");
		expect((nf as NF.Value & { type: "Lit" }).value).toEqual({ type: "Atom", value: "Unit" });
	});

	it("converts array to Array[row]", () => {
		const nf = Bridge.fromJson([1, 2, 3]);
		expect(nf.type).toBe("App");
		const app = nf as NF.Value & { type: "App" };
		expect(app.func.type).toBe("Lit");
		expect((app.func as NF.Value & { type: "Lit" }).value).toEqual({ type: "Atom", value: "Array" });
	});

	it("converts object to Schema[row]", () => {
		const nf = Bridge.fromJson({ x: 1, y: "two" });
		expect(nf.type).toBe("App");
		const app = nf as NF.Value & { type: "App" };
		expect(app.func.type).toBe("Lit");
		expect((app.func as NF.Value & { type: "Lit" }).value).toEqual({ type: "Atom", value: "Schema" });
	});
});

describe("roundtrip", () => {
	it("number roundtrips", () => {
		const original = 42;
		const result = Bridge.toJson(Bridge.fromJson(original));
		expect(result).toEqual(original);
	});

	it("object roundtrips", () => {
		const original = { x: 1, y: "two", nested: { a: true } };
		const nf = Bridge.fromJson(original);
		const result = Bridge.toJson(nf);
		expect(result).toEqual(original);
	});

	it("array roundtrips", () => {
		const original = [1, 2, 3];
		const nf = Bridge.fromJson(original);
		const result = Bridge.toJson(nf);
		expect(result).toEqual(original);
	});
});

describe("toPayload", () => {
	it("wraps primitives in { value: ... }", () => {
		const nf = NF.Constructors.Lit(Lit.Num(42));
		expect(Bridge.toPayload(nf)).toEqual({ value: 42 });
	});

	it("returns objects directly", () => {
		const row = R.Constructors.Extension("x", NF.Constructors.Lit(Lit.Num(1)), R.Constructors.Empty<NF.Value, NF.Variable>());
		const nf = NF.Constructors.Row(row);
		expect(Bridge.toPayload(nf)).toEqual({ x: 1 });
	});

	it("wraps arrays in { value: ... }", () => {
		const row = R.Constructors.Extension("0", NF.Constructors.Lit(Lit.Num(1)), R.Constructors.Empty<NF.Value, NF.Variable>());
		const nf = NF.Constructors.App(NF.Constructors.Lit(Lit.Atom("Array")), NF.Constructors.Row(row), "Explicit");
		expect(Bridge.toPayload(nf)).toEqual({ value: [1] });
	});
});

describe("fromPayload", () => {
	it("converts payload object to NF.Value", () => {
		const payload = { x: 1, y: "two" };
		const nf = Bridge.fromPayload(payload);
		expect(nf.type).toBe("App");
	});
});
