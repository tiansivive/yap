import { describe, it, expect, beforeEach } from "vitest";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as Lit from "@yap/shared/literals";

import * as Reader from "../reader";

// These tests use low-level construction to exercise the reader edge cases.
// Normal usage should go through NF.DSL.Rule helpers.

beforeEach(() => {
	NF.resetId();
});

const mkRow = (...fields: ReadonlyArray<[string, NF.Value]>): NF.Row =>
	fields.reduceRight<NF.Row>((acc, [label, value]) => R.Constructors.Extension(label, value, acc), R.Constructors.Empty());

const mkSchema = (...fields: ReadonlyArray<[string, NF.Value]>): NF.Value =>
	NF.Constructors.App(NF.Constructors.Lit(Lit.Atom("Schema")), NF.Constructors.Row(mkRow(...fields)), "Explicit");

const mkArray = (...elements: ReadonlyArray<NF.Value>): NF.Value => {
	const row = elements.reduceRight<NF.Row>((acc, el, idx) => R.Constructors.Extension(String(idx), el, acc), R.Constructors.Empty());
	return NF.Constructors.App(NF.Constructors.Lit(Lit.Atom("Array")), NF.Constructors.Row(row), "Explicit");
};

const str = (s: string): NF.Value => NF.Constructors.Lit(Lit.String(s));
const num = (n: number): NF.Value => NF.Constructors.Lit(Lit.Num(n));

describe("Reader.read", () => {
	it("reads a minimal rule with one pattern and no edges", () => {
		const pattern = mkSchema(["bind", str("n")], ["tag", str(":var")]);
		const constructor = mkSchema(["bind", str("n")], ["tag", str(":var")], ["payload", str("{}")]);
		const lhs = mkSchema(["nodes", mkArray(pattern)], ["edges", mkArray()]);
		const rhs = mkSchema(["nodes", mkArray(constructor)], ["edges", mkArray()]);
		const ruleNf = mkSchema(["lhs", lhs], ["rhs", rhs]);

		const rule = Reader.read(ruleNf);

		expect(rule.lhs.nodes).toHaveLength(1);
		expect(rule.lhs.nodes[0]).toEqual({ bind: "n", tag: ":var" });
		expect(rule.lhs.edges).toHaveLength(0);
		expect(rule.rhs.nodes).toHaveLength(1);
		expect(rule.rhs.nodes[0]).toEqual({ bind: "n", tag: ":var", payload: {} });
		expect(rule.rhs.edges).toHaveLength(0);
	});

	it("reads a rule with edges", () => {
		const pattern = mkSchema(["bind", str("n")], ["tag", str(":app")]);
		const edge = mkSchema(["source", str("n")], ["label", str(":func")], ["target", str("f")]);
		const constructor = mkSchema(["bind", str("n")], ["tag", str(":app")], ["payload", str("{}")]);
		const lhs = mkSchema(["nodes", mkArray(pattern)], ["edges", mkArray(edge)]);
		const rhs = mkSchema(["nodes", mkArray(constructor)], ["edges", mkArray()]);
		const ruleNf = mkSchema(["lhs", lhs], ["rhs", rhs]);

		const rule = Reader.read(ruleNf);

		expect(rule.lhs.edges).toHaveLength(1);
		expect(rule.lhs.edges[0]).toEqual({ source: "n", label: ":func", target: "f" });
	});

	it("reads constructor payload", () => {
		const pattern = mkSchema(["bind", str("n")], ["tag", str(":lit")]);
		const constructor = mkSchema(["bind", str("n")], ["tag", str(":lit")], ["payload", str('{"optimized": true}')]);
		const lhs = mkSchema(["nodes", mkArray(pattern)], ["edges", mkArray()]);
		const rhs = mkSchema(["nodes", mkArray(constructor)], ["edges", mkArray()]);
		const ruleNf = mkSchema(["lhs", lhs], ["rhs", rhs]);

		const rule = Reader.read(ruleNf);

		expect(rule.rhs.nodes[0].payload).toEqual({ optimized: true });
	});

	it("reads multiple patterns and constructors", () => {
		const p1 = mkSchema(["bind", str("a")], ["tag", str(":var")]);
		const p2 = mkSchema(["bind", str("b")], ["tag", str(":lit")]);
		const c1 = mkSchema(["bind", str("a")], ["tag", str(":var")], ["payload", str("{}")]);
		const c2 = mkSchema(["bind", str("b")], ["tag", str(":lit")], ["payload", str("{}")]);
		const lhs = mkSchema(["nodes", mkArray(p1, p2)], ["edges", mkArray()]);
		const rhs = mkSchema(["nodes", mkArray(c1, c2)], ["edges", mkArray()]);
		const ruleNf = mkSchema(["lhs", lhs], ["rhs", rhs]);

		const rule = Reader.read(ruleNf);

		expect(rule.lhs.nodes).toHaveLength(2);
		expect(rule.rhs.nodes).toHaveLength(2);
		expect(rule.lhs.nodes[0].bind).toBe("a");
		expect(rule.lhs.nodes[1].bind).toBe("b");
	});

	it("throws ReaderError for missing field", () => {
		const pattern = mkSchema(["bind", str("n")]); // missing tag
		const lhs = mkSchema(["nodes", mkArray(pattern)], ["edges", mkArray()]);
		const rhs = mkSchema(["nodes", mkArray()], ["edges", mkArray()]);
		const ruleNf = mkSchema(["lhs", lhs], ["rhs", rhs]);

		expect(() => Reader.read(ruleNf)).toThrow(Reader.ReaderError);
		expect(() => Reader.read(ruleNf)).toThrow("Missing field: tag");
	});

	it("throws ReaderError for wrong type", () => {
		const pattern = mkSchema(["bind", num(42)], ["tag", str(":var")]); // bind should be String, not Num
		const lhs = mkSchema(["nodes", mkArray(pattern)], ["edges", mkArray()]);
		const rhs = mkSchema(["nodes", mkArray()], ["edges", mkArray()]);
		const ruleNf = mkSchema(["lhs", lhs], ["rhs", rhs]);

		expect(() => Reader.read(ruleNf)).toThrow(Reader.ReaderError);
		expect(() => Reader.read(ruleNf)).toThrow("Expected String for Pattern.bind");
	});
});
