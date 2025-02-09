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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`1`);
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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`true`);
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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`"hello"`);
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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`Unit`);
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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`λx -> 1`);
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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`λ#x => 1`);
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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`Π(t1: <ω> Num) -> Num`);
			expect(NF.display(ty)).toStrictEqual(`Type`);
			expect(qs).toStrictEqual([]);

			cst.forEach(c => expect(EB.Display.Constraint(c)).toBe("Type ~~ Type"));
		});

		it("should elaborate pi types", () => {
			const row = `(x: Num) -> Num`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`Π(x: <ω> Num) -> Num`);
			expect(NF.display(ty)).toStrictEqual(`Type`);
			expect(qs).toStrictEqual([]);

			cst.forEach(c => expect(EB.Display.Constraint(c)).toBe("Type ~~ Type"));
		});

		it("should elaborate implicit pi types", () => {
			const row = `(x: Num) => Num`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`Π(#x: <ω> Num) => Num`);
			expect(NF.display(ty)).toStrictEqual(`Type`);
			expect(qs).toStrictEqual([]);

			cst.forEach(c => expect(EB.Display.Constraint(c)).toBe("Type ~~ Type"));
		});

		it("should constrain the pi output to a Type", () => {
			const row = `(x: Num) -> x`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();
			expect(EB.Display.Term(tm)).toStrictEqual(`Π(x: <ω> Num) -> v0`);
			expect(NF.display(ty)).toStrictEqual(`Type`);
			expect(qs).toStrictEqual([]);

			expect(cst.map(EB.Display.Constraint)).toContain("Num ~~ Type");
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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`[]`);
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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();
			expect(EB.Display.Term(tm)).toStrictEqual(`[ x: String, y: Num ]`);
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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`Struct [ x: 1, y: 2 ]`);
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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`λr -> Schema [ x: Num, y: Num | v0 ]`);
			expect(NF.display(ty)).toStrictEqual(`Π(r:<ω> ?1) -> Type`);
			expect(qs).toStrictEqual([]);

			expect(cst.length).toBe(2);
			const ensuringRow = EB.Display.Constraint(cst[0]);
			expect(ensuringRow).toBe("?1 ~~ Row");
			const usageConstraint = EB.Display.Constraint(cst[1]);
			expect(usageConstraint).toBe("ω <= ω"); // `r` gets assigned `ω`
		});

		it("should elaborate struct projections", () => {
			const row = `{ x: 1, y: 2 }.x`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`(Struct [ x: 1, y: 2 ]).x`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([]);
			expect(cst.length).toBe(1);
			expect(EB.Display.Constraint(cst[0])).toBe("Schema [ x: Num, y: Num ] ~~ Schema [ x: Num, y: Num ]");
		});

		it("should elaborate struct injections", () => {
			const row = `{ {x: 1, y: 2} | z = 3 }`;
			const data = parser.feed(row);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`{ Struct [ x: 1, y: 2 ] | z = 3 }`);
			// Rows don't have a fixed order. This happens because we recursively build the row from the base case (empty row)
			expect(NF.display(ty)).toStrictEqual(`Schema [ z: Num, x: Num, y: Num ]`);
			expect(qs).toStrictEqual([]);
			expect(cst).toStrictEqual([]);
		});
	});

	describe("Pattern matching", () => {
		const ctx = EB.bind(empty, { type: "Lambda", variable: "x" }, [NF.Constructors.Lit(Lit.Atom("Num")), Q.Many]);

		it("should elaborate literal pattern matching", () => {
			const src = `match x | 1 -> 2 | 3 -> 4`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(ctx);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`match v0\n| 1 -> 2\n| 3 -> 4`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

			// 1: to unify the two branches
			// 2: to unify each pattern with the scrutinee,
			expect(cst.length).toBe(2 + 1);
			cst.forEach(c => expect(EB.Display.Constraint(c)).toBe("Num ~~ Num"));
		});

		it("should unify each branch's return type", () => {
			const src = `match x | 1 -> 2 | 3 -> "hello"`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(ctx);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`match v0\n| 1 -> 2\n| 3 -> "hello"`);

			// 1: to unify the two branches
			// 2: to unify each pattern with the scrutinee,
			expect(cst.length).toBe(2 + 1);

			const prettyCst = cst.map(EB.Display.Constraint);

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

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`match v0\n| y -> 2\n| z -> 4`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

			// 1: to unify the two branches
			// 2: to unify each pattern with the scrutinee,
			expect(cst.length).toBe(2 + 1);

			const prettyCst = cst.map(EB.Display.Constraint);

			expect(prettyCst).toContain("Num ~~ Num");
			expect(prettyCst).toContain("?1 ~~ Num");
			expect(prettyCst).toContain("?2 ~~ Num");
		});

		describe("Structural Pattern Matching", () => {
			it("should elaborate struct pattern matching", () => {
				const src = `match x | { x: 1, y: 2 } -> 11 | { z: 3, w: 4 } -> 22`;
				const data = parser.feed(src);

				expect(data.results.length).toBe(1);

				const expr = data.results[0];

				const runReader = EB.infer(expr);
				const runWriter = runReader(ctx);

				const [[tm, ty, qs], { constraints: cst }] = runWriter();

				expect(EB.Display.Term(tm)).toStrictEqual(`match v0\n| Struct [ x: 1, y: 2 ] -> 11\n| Struct [ z: 3, w: 4 ] -> 22`);
				expect(NF.display(ty)).toStrictEqual(`Num`);
				expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

				// 1: to unify the two branches
				// 2: to unify each pattern with the scrutinee,
				expect(cst.length).toBe(2 + 1);

				const prettyCst = cst.map(EB.Display.Constraint);

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

				const [[tm, ty, qs], { constraints: cst }] = runWriter();

				expect(EB.Display.Term(tm)).toStrictEqual(`match v0\n| Struct [ x: 1, y: 2 | r ] -> v0\n| Struct [ z: 3, w: 4 | r ] -> v1`);
				expect(NF.display(ty)).toStrictEqual(`?1`); // return type is unified, so it just picks up the type of the first branch
				expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

				// 1: to unify the two branches
				// 2: to unify each pattern with the scrutinee,
				expect(cst.length).toBe(2 + 1);

				const prettyCst = cst.map(EB.Display.Constraint);

				expect(prettyCst).toContain("Num ~~ ?1"); // the return type is unified
				// Event tho both patterns introduce a row var `r`, their scopes are different, so their types are different metavariables
				expect(prettyCst).toContain("Schema [ x: Num, y: Num | ?1 ] ~~ Num"); // The first branch pattern is unified with the scrutinee
				expect(prettyCst).toContain("Schema [ z: Num, w: Num | ?2 ] ~~ Num"); // The second branch pattern is unified with the scrutinee
			});

			it("should bind variables in struct patterns", () => {
				const src = `match x | { x: y } -> y | { z: w } -> w`;
				const data = parser.feed(src);

				expect(data.results.length).toBe(1);

				const expr = data.results[0];

				const runReader = EB.infer(expr);
				const runWriter = runReader(ctx);

				const [[tm, ty, qs], { constraints: cst }] = runWriter();

				expect(EB.Display.Term(tm)).toStrictEqual(`match v0\n| Struct [ x: y ] -> v0\n| Struct [ z: w ] -> v0`);
				expect(NF.display(ty)).toStrictEqual(`?1`); // return type is unified, so it just picks up the type of the first branch

				expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

				// 1: to unify the two branches
				// 2: to unify each pattern with the scrutinee,
				expect(cst.length).toBe(2 + 1);

				const prettyCst = cst.map(EB.Display.Constraint);

				expect(prettyCst).toContain("?2 ~~ ?1"); // the return type is unified
				expect(prettyCst).toContain("Schema [ x: ?1 ] ~~ Num"); // The first branch pattern is unified with the scrutinee
				expect(prettyCst).toContain("Schema [ z: ?2 ] ~~ Num"); // The second branch pattern is unified with the scrutinee
			});

			it("should recursively bind variables in struct patterns", () => {
				const src = `match x | { foo: { y: y }, bar: f } -> f y | { z: { w: w } } -> w`;
				const data = parser.feed(src);

				expect(data.results.length).toBe(1);

				const expr = data.results[0];

				const runReader = EB.infer(expr);
				const runWriter = runReader(ctx);

				const [[tm, ty, qs], { constraints: cst }] = runWriter();

				// rows are elaborated from right to left, hence `f` is bound before `y`
				expect(EB.Display.Term(tm)).toStrictEqual(`match v0\n| Struct [ foo: Struct [ y: y ], bar: f ] -> v0 v1\n| Struct [ z: Struct [ w: w ] ] -> v0`);
				expect(NF.display(ty)).toStrictEqual(`?4`); // return type is unified, so it just picks up the type of the first branch

				expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

				// 1: to unify the two branches
				// 2: to unify each pattern with the scrutinee,
				// 2: for the application of `f` to `y`
				expect(cst.length).toBe(2 + 1 + 2);

				const prettyCst = cst.map(EB.Display.Constraint);

				expect(prettyCst).toContain("Schema [ foo: Schema [ y: ?1 ], bar: ?2 ] ~~ Num"); // The first branch pattern is unified with the scrutinee
				expect(prettyCst).toContain("?2 ~~ Π(x:<ω> ?3) -> ?4"); // Constraining the bound `f` to be a function
				expect(prettyCst).toContain("?1 ~~ ?3"); // Constraining the argument of `f` to be `y`
				expect(prettyCst).toContain("Schema [ z: Schema [ w: ?5 ] ] ~~ Num"); // The second branch pattern is unified with the scrutinee
				expect(prettyCst).toContain("?5 ~~ ?4"); // The return type of the second branch is unified with the return type of the first branch
			});
		});

		it("should pattern match on types", () => {
			const src = `match x | Num -> 1 | String -> "hello"`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(ctx);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`match v0\n| Imports.Num -> 1\n| Imports.String -> "hello"`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([Q.Many]); // from the `x` binding in the context

			// 1: to unify the two branches
			// 2: to unify each pattern with the scrutinee,
			expect(cst.length).toBe(2 + 1);

			const prettyCst = cst.map(EB.Display.Constraint);

			expect(prettyCst).toContain("Type ~~ Num");
			expect(prettyCst.filter(c => c === "Type ~~ Num").length).toBe(2);

			expect(prettyCst).toContain("String ~~ Num"); // Unifying the 2 branches
		});
	});

	describe("Recursion", () => {
		beforeEach(() => {
			parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar), { keepHistory: true });
			parser.grammar.start = "Statement";

			EB.resetSupply("meta");
			EB.resetSupply("var");
		});

		afterEach(() => {
			parser.finish();
		});

		it("should elaborate recursive functions in let decs", () => {
			const src = `let f = \\x -> f x`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.Stmt.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Statement(tm)).toStrictEqual(`let f: ?1 = λx -> v1 v0`);
			expect(NF.display(ty)).toStrictEqual(`Π(x:<ω> ?2) -> ?4`);

			expect(cst.length).toBe(4);
			const prettyCst = cst.map(EB.Display.Constraint);
			expect(prettyCst).toContain("?1 ~~ Π(x:<ω> ?3) -> ?4");
			expect(prettyCst).toContain("?1 ~~ Π(x:<ω> ?2) -> ?4");
			expect(prettyCst).toContain("?2 ~~ ?3");
		});

		it("should elaborate recursive types", () => {
			const src = `let List = \\(a: Type) -> | nil: a | cons: List a`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.Stmt.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Statement(tm)).toStrictEqual(`let List: ?1 = μx: ?1 -> λa -> Variant [ nil: v0, cons: v1 v0 ]`);
			expect(NF.display(ty)).toStrictEqual(`Π(a:<ω> Type) -> Type`);
			//expect(qs).toStrictEqual([]);

			expect(cst.length).toBe(5);

			const prettyCst = cst.map(EB.Display.Constraint);
			expect(prettyCst).toContain("Type ~~ Type"); // from the `a: Type` binding
			expect(prettyCst).toContain("?1 ~~ Π(x:<ω> ?3) -> ?4"); // from the application `List a`, List is a function
			expect(prettyCst).toContain("?1 ~~ Π(a:<ω> Type) -> Type"); // the letdec annotation must unify with the inferred type
			expect(prettyCst).toContain("Type ~~ ?3"); // from applying the List function to `a`, which is a type
			// the missing constraint is the one that deals with the usages
		});
	});

	describe("blocks", () => {
		it("should elaborate blocks", () => {
			const src = `{ let x = 1; let y = x; return y; }`;
			const data = parser.feed(src);

			expect(data.results.length).toBe(1);

			const expr = data.results[0];

			const runReader = EB.infer(expr);
			const runWriter = runReader(empty);

			const [[tm, ty, qs], { constraints: cst }] = runWriter();

			expect(EB.Display.Term(tm)).toStrictEqual(`{ let x: ?1 = 1; let y: ?2 = v1; return v0; }`);
			expect(NF.display(ty)).toStrictEqual(`Num`);
			expect(qs).toStrictEqual([]);

			expect(cst.length).toBe(2);
			const prettyCst = cst.map(EB.Display.Constraint);
			expect(prettyCst).toContain("?1 ~~ Num");
			expect(prettyCst).toContain("?2 ~~ Num");
		});
	});
});
