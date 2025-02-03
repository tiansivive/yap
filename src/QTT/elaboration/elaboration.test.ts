import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Nearley from "nearley";

import * as EB from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Lit from "@qtt/shared/literals";
import * as Q from "@qtt/shared/modalities/multiplicity";

import Grammar from "@qtt/src/grammar";

import * as Log from "@qtt/shared/logging";

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

	Log.push("test");

	beforeEach(() => {
		parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar), { keepHistory: true });
		parser.grammar.start = "Ann";

		EB.resetSupply("meta");
		EB.resetSupply("var");
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

		it("should elaborate implicit pi types", () => {
			const row = `(x: Num) => Num`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`Π(#x: <ω> Num) => Num`);
			expect(NF.display(ty)).toStrictEqual(`Type`);
			expect(qs).toStrictEqual([]);

			cst.forEach(c => expect(EB.displayConstraint(c)).toBe("Type ~~ Type"));
		});

		it("should constrain the pi output to a Type", () => {
			const row = `(x: Num) -> x`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();
			expect(EB.display(tm)).toStrictEqual(`Π(x: <ω> Num) -> v0`);
			expect(NF.display(ty)).toStrictEqual(`Type`);
			expect(qs).toStrictEqual([]);

			expect(cst.map(EB.displayConstraint)).toContain("Num ~~ Type");
		});
	});

	describe("Rows", () => {
		it("should elaborate empty rows", () => {
			const row = `[]`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`[]`);
			expect(NF.display(ty)).toStrictEqual(`Row`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
		});

		it("should elaborate row extensions", () => {
			const row = `[ x: String, y: Num ]`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();
			expect(EB.display(tm)).toStrictEqual(`[ x: String, y: Num ]`);
			expect(NF.display(ty)).toStrictEqual(`Row`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
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
			expect(NF.display(ty)).toStrictEqual(`Schema [ x: Num, y: Num ]`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
		});

		it("should elaborate row polymorphic schemas", () => {
			const row = `\\r -> { x:: Num, y:: Num | r }`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`λr -> Schema [ x: Num, y: Num | v0 ]`);
			expect(NF.display(ty)).toStrictEqual(`Π(r:<ω> ?1) -> Type`);
			expect(qs).toStrictEqual([]);

			expect(cst.length).toBe(2);
			const ensuringRow = EB.displayConstraint(cst[0]);
			expect(ensuringRow).toBe("?1 ~~ Row");
			const usageConstraint = EB.displayConstraint(cst[1]);
			expect(usageConstraint).toBe("ω <= ω"); // `r` gets assigned `ω`
		});

		it("should elaborate struct projections", () => {
			const row = `{ x: 1, y: 2 }.x`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`(Struct [ x: 1, y: 2 ]).x`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([]);
			expect(cst.length).toBe(1);
			expect(EB.displayConstraint(cst[0])).toBe("Schema [ x: Num, y: Num ] ~~ Schema [ x: Num, y: Num ]");
		});

		it("should elaborate struct injections", () => {
			const row = `{ {x: 1, y: 2} | z = 3 }`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`{ Struct [ x: 1, y: 2 ] | z = 3 }`);
			// Rows don't have a fixed order. This happens because we recursively build the row from the base case (empty row)
			expect(NF.display(ty)).toStrictEqual(`Schema [ z: Num, x: Num, y: Num ]`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
		});
	});

	describe("Pattern matching", () => {
		const ctx = EB.bind(empty, "x", [NF.Constructors.Lit(Lit.Atom("Num")), Q.Many]);

		it("should elaborate literal pattern matching", () => {
			const src = `match x | 1 -> 2 | 3 -> 4`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(ctx);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`match v0\n| 1 -> 2\n| 3 -> 4`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

			// 1: to unify the two branches
			// 2: to unify each pattern with the scrutinee,
			expect(cst.length).toBe(2 + 1);
			cst.forEach(c => expect(EB.displayConstraint(c)).toBe("Num ~~ Num"));
		});

		it("should unify each branch's return type", () => {
			const src = `match x | 1 -> 2 | 3 -> "hello"`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(ctx);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`match v0\n| 1 -> 2\n| 3 -> "hello"`);

			// 1: to unify the two branches
			// 2: to unify each pattern with the scrutinee,
			expect(cst.length).toBe(2 + 1);

			const prettyCst = cst.map(EB.displayConstraint);

			// the 2 literal patterns unify with the scrutinee
			expect(prettyCst).toContain("Num ~~ Num");
			// the two branches unify with each other
			expect(prettyCst).toContain("String ~~ Num");
		});

		it("should elaborate variable pattern matching", () => {
			const src = `match x | y -> 2 | z -> 4`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(ctx);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`match v0\n| y -> 2\n| z -> 4`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

			// 1: to unify the two branches
			// 2: to unify each pattern with the scrutinee,
			expect(cst.length).toBe(2 + 1);

			const prettyCst = cst.map(EB.displayConstraint);

			expect(prettyCst).toContain("Num ~~ Num");
			expect(prettyCst).toContain("?1 ~~ Num");
			expect(prettyCst).toContain("?2 ~~ Num");
		});

		it("should elaborate struct pattern matching", () => {
			const src = `match x | { x: 1, y: 2 } -> 11 | { z: 3, w: 4 } -> 22`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(ctx);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`match v0\n| Struct [ x: 1, y: 2 ] -> 11\n| Struct [ z: 3, w: 4 ] -> 22`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

			// 1: to unify the two branches
			// 2: to unify each pattern with the scrutinee,
			expect(cst.length).toBe(2 + 1);

			const prettyCst = cst.map(EB.displayConstraint);

			expect(prettyCst).toContain("Num ~~ Num");
			expect(prettyCst).toContain("Schema [ x: Num, y: Num ] ~~ Num");
			expect(prettyCst).toContain("Schema [ z: Num, w: Num ] ~~ Num");
		});

		it("should elaborate struct pattern matching with row polymorphism", () => {
			const src = `match x | { x: 1, y: 2 | r } -> r | { z: 3, w: 4 | r } -> x`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(ctx);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`match v0\n| Struct [ x: 1, y: 2 | r ] -> v0\n| Struct [ z: 3, w: 4 | r ] -> v1`);
			expect(NF.display(ty)).toStrictEqual(`?1`); // return type is unified, so it just picks up the type of the first branch
			expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

			// 1: to unify the two branches
			// 2: to unify each pattern with the scrutinee,
			expect(cst.length).toBe(2 + 1);

			const prettyCst = cst.map(EB.displayConstraint);

			expect(prettyCst).toContain("Num ~~ ?1"); // the return type is unified
			// Event tho both patterns introduce a row var `r`, their scopes are different, so their types are different metavariables
			expect(prettyCst).toContain("Schema [ x: Num, y: Num | ?1 ] ~~ Num"); // The first branch pattern is unified with the scrutinee
			expect(prettyCst).toContain("Schema [ z: Num, w: Num | ?2 ] ~~ Num"); // The second branch pattern is unified with the scrutinee
		});

		it("should pattern match on types", () => {
			const src = `match x | Num -> 1 | String -> "hello"`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(ctx);

			const [[tm, ty, qs], cst] = runWriter();

			expect(EB.display(tm)).toStrictEqual(`match v0\n| Imports.Num -> 1\n| Imports.String -> "hello"`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

			// 1: to unify the two branches
			// 2: to unify each pattern with the scrutinee,
			expect(cst.length).toBe(2 + 1);

			const prettyCst = cst.map(EB.displayConstraint);

			expect(prettyCst).toContain("Type ~~ Num");
			expect(prettyCst.filter(c => c === "Type ~~ Num").length).toBe(2);

			expect(prettyCst).toContain("String ~~ Num"); // Unifying the 2 branches
		});
	});
});
