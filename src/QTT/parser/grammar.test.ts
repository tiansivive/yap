import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Nearley from "nearley";
import Grammar from "./grammar";

import * as Ctor from "./terms";

describe("Grammar", () => {
	let parser: Nearley.Parser;

	beforeEach(() => {
		parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar), { keepHistory: true });
	});

	afterEach(() => {
		parser.finish();
	});

	describe("Expressions", () => {
		beforeEach(() => {
			parser.grammar.start = "Ann";
		});
		describe("Literals", () => {
			it("should parse numbers:\t\t1", () => {
				const literal = `1`;
				const data = parser.feed(literal);

				const one = Ctor.num(1);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(one);
			});

			it.skip("should parse booleans:\t\ttrue", () => {
				const literal = `true`;

				const data = parser.feed(literal);
				const tr = Ctor.bool(true);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(tr);
			});

			it('should parse strings:\t\t"hello"', () => {
				const literal = `"hello"`;
				const data = parser.feed(literal);

				const hello = Ctor.str("hello");

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(hello);
			});
		});

		describe("Variables", () => {
			it("should parse variables:\t\tx", () => {
				const variable = `x`;
				const data = parser.feed(variable);

				const x = Ctor.Var({ type: "name", value: "x" });

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(x);
			});
		});

		describe("Functions", () => {
			it("should parse arrows:\t\t\t1 -> 2", () => {
				const arrow = `1 -> 2`;
				const data = parser.feed(arrow);

				const one = Ctor.num(1);
				const two = Ctor.num(2);
				const arr = Ctor.Arrow(one, two, "Explicit");

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(arr);
			});

			it("should parse pi types:\t\t(x: 1) -> 2", () => {
				const pi = `(x: 1) -> 2`;
				const data = parser.feed(pi);

				const one = Ctor.num(1);
				const two = Ctor.num(2);
				const p = Ctor.Pi("Explicit", "x", one, two);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(p);
			});

			it("should parse implicit pi types:\t(x: Int) => 2", () => {
				const pi = `(x: Int) => 2`;
				const data = parser.feed(pi);

				const int = Ctor.Var({ type: "name", value: "Int" });
				const two = Ctor.num(2);
				const p = Ctor.Pi("Implicit", "x", int, two);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(p);
			});

			it("should parse lambdas:\t\t\\x -> 2", () => {
				const lambda = `\\x -> 2`;
				const data = parser.feed(lambda);

				const two = Ctor.num(2);
				const l = Ctor.Lambda("Explicit", "x", two);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(l);
			});

			it("should parse implicit lambdas:\t\\#x => 2", () => {
				const lambda = `\\#x => 2`;
				const data = parser.feed(lambda);

				const two = Ctor.num(2);
				const l = Ctor.Lambda("Implicit", "x", two);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(l);
			});
		});

		describe("Applications", () => {
			it("should parse applications:\t\tf x", () => {
				const application = `f x`;
				const data = parser.feed(application);

				const f = Ctor.Var({ type: "name", value: "f" });
				const x = Ctor.Var({ type: "name", value: "x" });
				const app = Ctor.Application(f, x, "Explicit");

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(app);
			});

			it.skip("should parse implicit applications:\tf #x", () => {
				const application = `f #x`;
				const data = parser.feed(application);

				const f = Ctor.Var({ type: "name", value: "f" });
				const x = Ctor.Var({ type: "name", value: "x" });
				const app = Ctor.Application(f, x, "Implicit");

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(app);
			});
		});

		describe("Annotations", () => {
			it("should parse annotations:\t\tx: Int", () => {
				const annotation = `x: Int`;
				const data = parser.feed(annotation);

				const x = Ctor.Var({ type: "name", value: "x" });
				const int = Ctor.Var({ type: "name", value: "Int" });
				const ann = Ctor.Annotation(x, int);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(ann);
			});
		});

		describe("Row terms", () => {
			it.skip("should parse empty rows:\t\t[]", () => {
				const src = `[]`;
				const data = parser.feed(src);

				const empty = Ctor.Row({ type: "empty" });

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(empty);
			});

			it("should parse empty structs:\t\t{}", () => {
				const src = `{}`;
				const data = parser.feed(src);

				const empty = Ctor.Struct({ type: "empty" });

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(empty);
			});

			it("should parse structs:\t\t{ x: 1, y: 2 }", () => {
				const src = `{ x: 1, y: 2 }`;
				const data = parser.feed(src);

				const xVal = Ctor.num(1);
				const yVal = Ctor.num(2);

				const row = data.results[0];

				const empty: Ctor.Row = { type: "empty" };
				const y: Ctor.Row = { type: "extension", label: "y", value: yVal, row: empty };
				const x: Ctor.Row = { type: "extension", label: "x", value: xVal, row: y };
				const expected = Ctor.Struct(x);

				expect(data.results.length).toBe(1);
				expect(row).toStrictEqual(expected);
			});

			it("should parse schemas:\t\t{ x: 1, y: 2 }", () => {
				// parser.grammar.start = "TypeExpr";
				const src = `{ x:: 1, y:: 2 }`;
				const data = parser.feed(src);

				const xVal = Ctor.num(1);
				const yVal = Ctor.num(2);

				const row = data.results[0];

				const empty: Ctor.Row = { type: "empty" };
				const y: Ctor.Row = { type: "extension", label: "y", value: yVal, row: empty };
				const x: Ctor.Row = { type: "extension", label: "x", value: xVal, row: y };
				const expected = Ctor.Schema(x);

				expect(data.results.length).toBe(1);
				expect(row).toStrictEqual(expected);
			});

			it("should parse variants:\t\t| x: 1 | y: 2", () => {
				const src = `| x: 1 | y: 2`;
				const data = parser.feed(src);

				const xVal = Ctor.num(1);
				const yVal = Ctor.num(2);

				const row = data.results[0];

				const empty: Ctor.Row = { type: "empty" };
				const y: Ctor.Row = { type: "extension", label: "y", value: yVal, row: empty };
				const x: Ctor.Row = { type: "extension", label: "x", value: xVal, row: y };
				const expected = Ctor.Variant(x);

				expect(data.results.length).toBe(1);
				expect(row).toStrictEqual(expected);
			});

			it("should parse tuples:\t\t{1, 2}", () => {
				const src = `{1, 2}`;
				const data = parser.feed(src);

				const one = Ctor.num(1);
				const two = Ctor.num(2);

				const tuple = Ctor.Tuple([one, two]);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(tuple);
			});

			it("should parse lists:\t\t[1, 2]", () => {
				const src = `[1, 2]`;
				const data = parser.feed(src);

				const one = Ctor.num(1);
				const two = Ctor.num(2);

				const list = Ctor.List([one, two]);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(list);
			});

			it("should parse projections:\t\tx.y", () => {
				const src = `x.y`;
				const data = parser.feed(src);

				const x = Ctor.Var({ type: "name", value: "x" });
				const proj = Ctor.Projection("y", x);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(proj);
			});

			it("should parse shorthand projections:\t.x", () => {
				const src = `.x`;
				const data = parser.feed(src);

				const generatedName = "x";
				const obj = Ctor.Var({ type: "name", value: generatedName });
				const proj = Ctor.Projection("x", obj);
				const lambda = Ctor.Lambda("Explicit", generatedName, proj);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(lambda);
			});

			it("should parse injections:\t\t{ x | y = 1}", () => {
				const src = `{ x | y = 1 }`;
				const data = parser.feed(src);

				const x = Ctor.Var({ type: "name", value: "x" });
				const one = Ctor.num(1);

				const inj = Ctor.Injection("y", one, x);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(inj);
			});

			it("should parse shorthand injections:\t{ | y = 1}", () => {
				const src = `{ | y = 1 }`;
				const data = parser.feed(src);

				const generatedName = "x";
				const obj = Ctor.Var({ type: "name", value: generatedName });
				const one = Ctor.num(1);

				const inj = Ctor.Injection("y", one, obj);
				const lambda = Ctor.Lambda("Explicit", generatedName, inj);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(lambda);
			});
		});

		describe("Blocks", () => {
			it("should parse expression in a block:\t\t{ 1; x; }", () => {
				const src = `{ 1; x; }`;
				const data = parser.feed(src);

				const one = Ctor.num(1);
				const x = Ctor.Var({ type: "name", value: "x" });

				const block = Ctor.Block([Ctor.Expression(one), Ctor.Expression(x)]);
				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(block);
			});

			it("should parse block with a return value:\t{ x; return 2; }", () => {
				const src = `{ x; return 2; }`;
				const data = parser.feed(src);

				const x = Ctor.Var({ type: "name", value: "x" });
				const two = Ctor.num(2);

				const block = Ctor.Block([Ctor.Expression(x)], two);
				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(block);
			});

			it("should parse a block with a return value:\t{ return 2; }", () => {
				const src = `{ return 2; }`;
				const data = parser.feed(src);

				const two = Ctor.num(2);

				const block = Ctor.Block([], two);
				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(block);
			});
		});

		describe("Pattern matching", () => {
			it('should parse a match expression:\t\tmatch x | 1 -> 10 | y -> "hello"', () => {
				const src = `match x
					| 1 -> 10
					| y -> "hello"`;
				const data = parser.feed(src);

				const x = Ctor.Var({ type: "name", value: "x" });
				const one = Ctor.Patterns.Lit({ type: "Num", value: 1 });
				const ten = Ctor.num(10);
				const y = Ctor.Patterns.Var({ type: "name", value: "y" });
				const hello = Ctor.str("hello");

				const match = Ctor.Match(x, [Ctor.Alternative(one, ten), Ctor.Alternative(y, hello)]);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(match);
			});

			it.skip("should parse a match expression for structs:\tmatch x | { x: 1, y: 2 } -> 10 | { x: 2, y: 1 } -> 20", () => {
				const src = `match x
					| { x: 1, y: 2 } -> 10
					| { x: 2, y: 1 } -> 20`;
				const data = parser.feed(src);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(undefined);
			});
		});

		describe("Statements", () => {
			beforeEach(() => {
				parser.grammar.start = "Statement";
			});
			it("should parse let decs:\t\tlet x = 1", () => {
				const src = `let x = 1`;
				const data = parser.feed(src);

				const x = "x";
				const one = Ctor.num(1);

				const letDec = Ctor.Let(x, one);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(letDec);
			});
		});

		describe("Precedence", () => {
			it("should parse a lambda with an application:\t\\x -> f x", () => {
				const src = `\\x -> f x`;
				const data = parser.feed(src);

				const x = "x";
				const f = Ctor.Var({ type: "name", value: "f" });
				const app = Ctor.Application(f, Ctor.Var({ type: "name", value: x }));

				const lambda = Ctor.Lambda("Explicit", x, app);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(lambda);
			});

			it("should parse a projection with an application:\tx.y z", () => {
				const src = `x.y z`;
				const data = parser.feed(src);

				const x = Ctor.Var({ type: "name", value: "x" });
				const xy = Ctor.Projection("y", x);
				const z = Ctor.Var({ type: "name", value: "z" });

				const app = Ctor.Application(xy, z, "Explicit");

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(app);
			});

			it("should parse a lambda with an annotation:\t\\x -> y : Int -> Int", () => {
				const src = `\\x -> y : Int -> Int`;
				const data = parser.feed(src);

				const x = "x";
				const y = Ctor.Var({ type: "name", value: "y" });
				const int = Ctor.Var({ type: "name", value: "Int" });
				const arrow = Ctor.Arrow(int, int, "Explicit");

				const lambda = Ctor.Lambda("Explicit", x, y);
				const ann = Ctor.Annotation(lambda, arrow);

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(ann);
			});
		});
	});
});
