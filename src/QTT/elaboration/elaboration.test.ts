import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Nearley from "nearley";

import * as EB from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Lit from "@qtt/shared/literals";
import * as Q from "@qtt/shared/modalities/multiplicity";

import Grammar from "@qtt/src/grammar";

describe("Elaboration", () => {
	let parser: Nearley.Parser;
	const empty: EB.Context = {
		env: [],
		types: [],
		names: [],
		imports: {
			Num: [EB.Constructors.Lit(Lit.Atom("Num")), NF.Type, []],
			Bool: [EB.Constructors.Lit(Lit.Atom("Bool")), NF.Type, []],
			String: [EB.Constructors.Lit(Lit.Atom("String")), NF.Type, []],
			Unit: [EB.Constructors.Lit(Lit.Atom("Unit")), NF.Type, []],
		},
	};

	beforeEach(() => {
		parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar), { keepHistory: true });
		parser.grammar.start = "Ann";
	});

	afterEach(() => {
		parser.finish();
	});

	describe("Literals", () => {
		it("should elaborate numbers", () => {
			const row = `1`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`1`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
		});

		it.skip("should elaborate booleans", () => {
			const row = `true`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`true`);
			expect(NF.display(ty)).toStrictEqual(`Bool`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
		});

		it("should elaborate strings", () => {
			const row = `"hello"`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`"hello"`);
			expect(NF.display(ty)).toStrictEqual(`String`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
		});

		it.skip("should elaborate units", () => {
			const row = `unit`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`Unit`);
			expect(NF.display(ty)).toStrictEqual(`Unit`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
		});
	});

	describe("Functions", () => {
		beforeEach(() => {
			EB.resetCount();
		});

		it("should elaborate lambda abstractions", () => {
			const row = `\\x -> 1`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`λx -> 1`);
			expect(NF.display(ty)).toStrictEqual(`Π(x:<ω> ?1) -> Num`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([{ type: "usage", computed: Q.Zero, expected: Q.Many }]);
		});

		it("should elaborate implicit lambda abstractions", () => {
			const row = `\\#x => 1`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`λ#x => 1`);
			expect(NF.display(ty)).toStrictEqual(`Π(#x:<ω> ?1) => Num`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([{ type: "usage", computed: Q.Zero, expected: Q.Many }]);
		});

		it("should elaborate arrows", () => {
			const row = `Num -> Num`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`Π(t1: <ω> Num) -> Num`);
			expect(NF.display(ty)).toStrictEqual(`Type`);
			expect(qs).toStrictEqual([]);

			cst.forEach(c => expect(EB.displayConstraint(c)).toBe("Type ~~ Type"));
		});

		it("should elaborate pi types", () => {
			const row = `(x: Num) -> Num`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`Π(x: <ω> Num) -> Num`);
			expect(NF.display(ty)).toStrictEqual(`Type`);
			expect(qs).toStrictEqual([]);

			cst.forEach(c => expect(EB.displayConstraint(c)).toBe("Type ~~ Type"));
		});
	});

	describe("Structs", () => {
		it("should elaborate structs with multiple fields", () => {
			const row = `{ x: 1, y: 2 }`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`Struct [ x: 1, y: 2 ]`);
			expect(NF.display(ty)).toStrictEqual(`Struct [ x: Num, y: Num ]`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
		});

		it.skip("should elaborate row polymorphic structs", () => {
			const row = `{ x: 1, y: 2 | r }`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`Struct [ x: 1, y: 2 | r ]`);
			expect(NF.display(ty)).toStrictEqual(`Struct [ x: Num, y: Num | r ]`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
		});
	});
});
