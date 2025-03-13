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
			parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar), { keepHistory: true });
			parser.grammar.start = "Ann";
		});
		describe("Literals", () => {
			it("should parse numbers:\t\t1", () => {
				const literal = `1`;
				const data = parser.feed(literal);

				const expr = data.results[0];

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("lit");
				expect(expr.value).toStrictEqual({ type: "Num", value: 1 });
			});

			it.skip("should parse booleans:\t\ttrue", () => {
				const literal = `true`;

				const data = parser.feed(literal);

				const expr = data.results[0];

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("lit");
				expect(expr.value).toStrictEqual({ type: "Bool", value: true });
			});

			it('should parse strings:\t\t"hello"', () => {
				const literal = `"hello"`;
				const data = parser.feed(literal);

				const expr = data.results[0];

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("lit");
				expect(expr.value).toStrictEqual({ type: "String", value: "hello" });
			});
		});

		describe("Variables", () => {
			it("should parse variables:\t\tx", () => {
				const variable = `x`;
				const data = parser.feed(variable);

				const expr = data.results[0];

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("var");
				expect(expr.variable).toMatchObject({ type: "name", value: "x" });
			});
		});

		describe("Functions", () => {
			it("should parse arrows:\t\t\t1 -> 2", () => {
				const arrow = `1 -> 2`;
				const data = parser.feed(arrow);

				const expr = data.results[0];

				const one = { type: "Num", value: 1 };
				const two = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("arrow");
				expect(expr.icit).toBe("Explicit");
				expect(expr.lhs).toMatchObject({ type: "lit", value: one });
				expect(expr.rhs).toMatchObject({ type: "lit", value: two });
			});

			it("should parse pi types:\t\t(x: 1) -> 2", () => {
				const pi = `(x: 1) -> 2`;
				const data = parser.feed(pi);

				const expr = data.results[0];

				const one = { type: "Num", value: 1 };
				const two = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("pi");
				expect(expr.icit).toBe("Explicit");
				expect(expr.variable).toBe("x");
				expect(expr.annotation).toMatchObject({ type: "lit", value: one });
				expect(expr.body).toMatchObject({ type: "lit", value: two });
			});

			it("should parse nested pi types:\t(x: Int) -> (y: Int) -> 2", () => {
				const pi = `(x: Int) -> (y: Int) -> 2`;
				const data = parser.feed(pi);

				const expr = data.results[0];

				const int = { type: "name", value: "Int" };
				const two = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("pi");
				expect(expr.icit).toBe("Explicit");
				expect(expr.variable).toBe("x");
				expect(expr.annotation).toMatchObject({ type: "var", variable: int });
				expect(expr.body.type).toBe("pi");
				expect(expr.body.variable).toBe("y");
				expect(expr.body.annotation).toMatchObject({ type: "var", variable: int });
				expect(expr.body.body).toMatchObject({ type: "lit", value: two });
			});
			it("should parse implicit pi types:\t(x: Int) => 2", () => {
				const pi = `(x: Int) => 2`;
				const data = parser.feed(pi);

				const expr = data.results[0];

				const int = { type: "name", value: "Int" };
				const two = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("pi");
				expect(expr.icit).toBe("Implicit");
				expect(expr.variable).toBe("x");
				expect(expr.annotation).toMatchObject({ type: "var", variable: int });
				expect(expr.body).toMatchObject({ type: "lit", value: two });
			});

			it("should parse lambdas:\t\t\\x -> 2", () => {
				const lambda = `\\x -> 2`;
				const data = parser.feed(lambda);

				const expr = data.results[0];

				const two = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("lambda");
				expect(expr.icit).toBe("Explicit");
				expect(expr.variable).toBe("x");
				expect(expr.body).toMatchObject({ type: "lit", value: two });
			});

			it("should parse implicit lambdas:\t\\x => 2", () => {
				const lambda = `\\x => 2`;
				const data = parser.feed(lambda);

				const expr = data.results[0];

				const two = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("lambda");
				expect(expr.icit).toBe("Implicit");
				expect(expr.variable).toBe("x");
				expect(expr.body).toMatchObject({ type: "lit", value: two });
			});
		});

		describe("Applications", () => {
			it("should parse applications:\t\tf x", () => {
				const application = `f x`;
				const data = parser.feed(application);

				const expr = data.results[0];

				const f = { type: "name", value: "f" };
				const x = { type: "name", value: "x" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("application");
				expect(expr.icit).toBe("Explicit");
				expect(expr.fn).toMatchObject({ type: "var", variable: f });
				expect(expr.arg).toMatchObject({ type: "var", variable: x });
			});

			it.skip("should parse implicit applications:\tf #x", () => {
				const application = `f #x`;
				const data = parser.feed(application);

				const expr = data.results[0];

				const f = { type: "name", value: "f" };
				const x = { type: "name", value: "x" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("application");
				expect(expr.icit).toBe("Implicit");
				expect(expr.fn).toMatchObject({ type: "var", variable: f });
				expect(expr.arg).toMatchObject({ type: "var", variable: x });
			});

			it("should parse nested applications:\tf x y", () => {
				const application = `f x y`;
				const data = parser.feed(application);

				const expr = data.results[0];

				const f = { type: "name", value: "f" };
				const x = { type: "name", value: "x" };
				const y = { type: "name", value: "y" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("application");
				expect(expr.icit).toBe("Explicit");
				expect(expr.arg).toMatchObject({ type: "var", variable: y });

				expect(expr.fn).toMatchObject({ type: "application" });
				expect(expr.fn.fn).toMatchObject({ type: "var", variable: f });
				expect(expr.fn.arg).toMatchObject({ type: "var", variable: x });
			});
		});

		describe("Annotations", () => {
			it("should parse annotations:\t\tx: Int", () => {
				const annotation = `x: Int`;
				const data = parser.feed(annotation);

				const expr = data.results[0];

				const x = { type: "name", value: "x" };
				const int = { type: "name", value: "Int" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("annotation");
				expect(expr.term).toMatchObject({ type: "var", variable: x });
				expect(expr.ann).toMatchObject({ type: "var", variable: int });
			});
		});

		describe("Row terms", () => {
			it("should parse empty rows:\t\t[]", () => {
				const src = `[]`;
				const data = parser.feed(src);

				const expr = data.results[0];

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("row");
				expect(expr.row).toMatchObject({ type: "empty" });
			});

			it("should parse empty structs:\t\t{}", () => {
				const src = `{}`;
				const data = parser.feed(src);

				const expr = data.results[0];

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("struct");
				expect(expr.row).toMatchObject({ type: "empty" });
			});

			it("should parse structs:\t\t{ x: 1, y: 2 }", () => {
				const src = `{ x: 1, y: 2 }`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const xVal = { type: "Num", value: 1 };
				const yVal = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("struct");
				expect(expr.row.type).toBe("extension");
				expect(expr.row.label).toBe("x");
				expect(expr.row.value).toMatchObject({ type: "lit", value: xVal });

				const extension = expr.row.row;
				expect(extension.type).toBe("extension");
				expect(extension.label).toBe("y");
				expect(extension.value).toMatchObject({ type: "lit", value: yVal });
				expect(extension.row.type).toBe("empty");
			});

			it("should parse schemas:\t\t{ x:: 1, y:: 2 }", () => {
				// parser.grammar.start = "TypeExpr";
				const src = `{ x:: 1, y:: 2 }`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const xVal = { type: "Num", value: 1 };
				const yVal = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("schema");
				expect(expr.row.type).toBe("extension");
				expect(expr.row.label).toBe("x");
				expect(expr.row.value).toMatchObject({ type: "lit", value: xVal });

				const extension = expr.row.row;
				expect(extension.type).toBe("extension");
				expect(extension.label).toBe("y");
				expect(extension.value).toMatchObject({ type: "lit", value: yVal });
				expect(extension.row.type).toBe("empty");
			});

			it("should parse variants:\t\t| x: 1 | y: 2", () => {
				const src = `| #x 1 | #y 2`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const xVal = { type: "Num", value: 1 };
				const yVal = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("variant");
				expect(expr.row.type).toBe("extension");
				expect(expr.row.label).toBe("x");
				expect(expr.row.value).toMatchObject({ type: "lit", value: xVal });

				const extension = expr.row.row;
				expect(extension.type).toBe("extension");
				expect(extension.label).toBe("y");
				expect(extension.value).toMatchObject({ type: "lit", value: yVal });
				expect(extension.row.type).toBe("empty");
			});

			it("should parse tuples:\t\t{1, 2}", () => {
				const src = `{1, 2}`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const one = { type: "Num", value: 1 };
				const two = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("tuple");
				expect(expr.row.type).toBe("extension");
				expect(expr.row.label).toBe("0");
				expect(expr.row.value).toMatchObject({ type: "lit", value: one });

				const extension = expr.row.row;
				expect(extension.type).toBe("extension");
				expect(extension.label).toBe("1");
				expect(extension.value).toMatchObject({ type: "lit", value: two });
				expect(extension.row.type).toBe("empty");
			});

			it("should parse lists:\t\t[1, 2]", () => {
				const src = `[1, 2]`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const one = { type: "Num", value: 1 };
				const two = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("list");
				expect(expr.elements.length).toBe(2);

				expect(expr.elements[0]).toMatchObject({ type: "lit", value: one });
				expect(expr.elements[1]).toMatchObject({ type: "lit", value: two });
			});

			it("should parse projections:\t\tx.y", () => {
				const src = `x.y`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const x = { type: "name", value: "x" };
				const y = "y";

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("projection");

				expect(expr.label).toBe(y);
				expect(expr.term).toMatchObject({ type: "var", variable: x });
			});

			it("should parse shorthand projections:\t.x", () => {
				const src = `.x`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const generatedParam = { type: "name", value: "x" };
				const term = { type: "var", variable: generatedParam };
				const label = "x";
				const proj = { type: "projection", label, term };

				expect(data.results.length).toBe(1);

				expect(expr.type).toBe("lambda");
				expect(expr.icit).toBe("Explicit");
				expect(expr.variable).toBe(generatedParam.value);
				expect(expr.body).toMatchObject(proj);
			});

			it("should parse injections:\t\t{ x | y = 1}", () => {
				const src = `{ x | y = 1 }`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const x = { type: "name", value: "x" };
				const y = "y";
				const one = { type: "Num", value: 1 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("injection");
				expect(expr.term).toMatchObject({ type: "var", variable: x });
				expect(expr.label).toBe(y);
				expect(expr.value).toMatchObject({ type: "lit", value: one });
			});

			it("should parse shorthand injections:\t{ | y = 1}", () => {
				const src = `{ | y = 1 }`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const generatedParam = { type: "name", value: "x" };
				const term = { type: "var", variable: generatedParam };
				const label = "y";
				const value = { type: "lit", value: { type: "Num", value: 1 } };
				const inj = { type: "injection", term, label, value };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("lambda");
				expect(expr.icit).toBe("Explicit");
				expect(expr.variable).toBe(generatedParam.value);
				expect(expr.body).toMatchObject(inj);
			});
		});

		describe("Blocks", () => {
			it("should parse expression in a block:\t\t{ 1; x; }", () => {
				const src = `{ 1; x; }`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const one = { type: "Num", value: 1 };
				const x = { type: "name", value: "x" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("block");

				expect(expr.statements.length).toBe(2);
				expect(expr.statements[0].type).toBe("expression");
				expect(expr.statements[0].value).toMatchObject({ type: "lit", value: one });
				expect(expr.statements[1].type).toBe("expression");
				expect(expr.statements[1].value).toMatchObject({ type: "var", variable: x });

				expect(expr.return).toBeUndefined();
			});

			it("should parse block with a return value:\t{ x; return 2; }", () => {
				const src = `{ x; return 2; }`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const x = { type: "name", value: "x" };
				const two = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("block");

				expect(expr.statements.length).toBe(1);
				expect(expr.statements[0].type).toBe("expression");
				expect(expr.statements[0].value).toMatchObject({ type: "var", variable: x });

				expect(expr.return).toMatchObject({ type: "lit", value: two });
			});

			it("should parse a block with only a return value:\t{ return 2; }", () => {
				const src = `{ return 2; }`;
				const data = parser.feed(src);

				const expr = data.results[0];
				const two = { type: "Num", value: 2 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("block");

				expect(expr.statements.length).toBe(0);
				expect(expr.return).toMatchObject({ type: "lit", value: two });
			});
		});

		describe("Pattern matching", () => {
			it('should parse a match expression:\t\tmatch x | 1 -> 10 | y -> "hello"', () => {
				const src = `match x
					| 1 -> 10
					| y -> "hello"`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const x = { type: "name", value: "x" };

				const one = { type: "Num", value: 1 };
				const ten = { type: "Num", value: 10 };

				const y = { type: "name", value: "y" };
				const hello = { type: "String", value: "hello" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("match");
				expect(expr.scrutinee).toMatchObject({ type: "var", variable: x });

				expect(expr.alternatives.length).toBe(2);
				expect(expr.alternatives[0].pattern).toMatchObject({ type: "lit", value: one });
				expect(expr.alternatives[0].term).toMatchObject({ type: "lit", value: ten });

				expect(expr.alternatives[1].pattern).toMatchObject({ type: "var", value: y });
				expect(expr.alternatives[1].term).toMatchObject({ type: "lit", value: hello });
			});

			it("should parse a match expression for structs:\tmatch x | { x: 1, y: 2 } -> 10 | { x: 2, y: 1 } -> 20", () => {
				const src = `match x
					| { x: 1, y: 2 } -> 10
					| { x: 2, y: 1 } -> 20`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const x = { type: "name", value: "x" };
				const one = { type: "Num", value: 1 };
				const two = { type: "Num", value: 2 };

				const struct1 = {
					type: "struct",
					row: {
						type: "extension",
						label: "x",
						value: { type: "lit", value: one },
						row: { type: "extension", label: "y", value: { type: "lit", value: two }, row: { type: "empty" } },
					},
				};
				const ten = { type: "Num", value: 10 };

				const struct2 = {
					type: "struct",
					row: {
						type: "extension",
						label: "x",
						value: { type: "lit", value: two },
						row: { type: "extension", label: "y", value: { type: "lit", value: one }, row: { type: "empty" } },
					},
				};
				const twenty = { type: "Num", value: 20 };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("match");
				expect(expr.scrutinee).toMatchObject({ type: "var", variable: x });

				expect(expr.alternatives.length).toBe(2);
				expect(expr.alternatives[0].pattern).toMatchObject(struct1);
				expect(expr.alternatives[0].term).toMatchObject({ type: "lit", value: ten });
				expect(expr.alternatives[1].pattern).toMatchObject(struct2);
				expect(expr.alternatives[1].term).toMatchObject({ type: "lit", value: twenty });
			});
		});

		it("should parse a match expression with variants:\tmatch x | x: 1 -> 10 | y: 2 -> 20", () => {
			const src = `match x
				| x: 1 -> 10
				| y: 2 -> 20`;
			const data = parser.feed(src);

			const expr = data.results[0];

			const x = { type: "name", value: "x" };
			const one = { type: "Num", value: 1 };
			const two = { type: "Num", value: 2 };

			const variant1 = {
				type: "variant",
				row: {
					type: "extension",
					label: "x",
					value: { type: "lit", value: one },
					row: { type: "empty" },
				},
			};
			const ten = { type: "Num", value: 10 };

			const variant2 = {
				type: "variant",
				row: {
					type: "extension",
					label: "y",
					value: { type: "lit", value: two },
					row: { type: "empty" },
				},
			};
			const twenty = { type: "Num", value: 20 };

			expect(data.results.length).toBe(1);
			expect(expr.type).toBe("match");
			expect(expr.scrutinee).toMatchObject({ type: "var", variable: x });

			expect(expr.alternatives.length).toBe(2);
			expect(expr.alternatives[0].pattern).toMatchObject(variant1);
			expect(expr.alternatives[0].term).toMatchObject({ type: "lit", value: ten });
			expect(expr.alternatives[1].pattern).toMatchObject(variant2);
			expect(expr.alternatives[1].term).toMatchObject({ type: "lit", value: twenty });
		});

		describe("Statements", () => {
			beforeEach(() => {
				parser.grammar.start = "Statement";
			});
			it("should parse let decs:\t\tlet x = 1", () => {
				const src = `let x = 1`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const one = { type: "Num", value: 1 };
				const x = "x";

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("let");
				expect(expr.variable).toBe(x);
				expect(expr.value).toMatchObject({ type: "lit", value: one });
			});
		});

		describe("Precedence", () => {
			it("should parse a lambda with an application:\t\\x -> f x", () => {
				const src = `\\x -> f x`;
				const data = parser.feed(src);
				const expr = data.results[0];

				const x = { type: "name", value: "x" };
				const f = { type: "name", value: "f" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("lambda");
				expect(expr.icit).toBe("Explicit");
				expect(expr.variable).toBe("x");
				expect(expr.body.type).toBe("application");
				expect(expr.body.fn).toMatchObject({ type: "var", variable: f });
				expect(expr.body.arg).toMatchObject({ type: "var", variable: x });
			});

			it("should parse a projection with an application:\tx.y z", () => {
				const src = `x.y z`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const x = { type: "name", value: "x" };
				const y = "y";
				const z = { type: "name", value: "z" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("application");
				expect(expr.arg).toMatchObject({ type: "var", variable: z });
				expect(expr.fn.type).toBe("projection");
				expect(expr.fn.label).toBe(y);
				expect(expr.fn.term).toMatchObject({ type: "var", variable: x });
			});

			it("should parse a lambda with a projection:\t\\x -> x.y", () => {
				const src = `\\x -> x.y`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const x = { type: "name", value: "x" };
				const y = "y";

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("lambda");
				expect(expr.icit).toBe("Explicit");
				expect(expr.variable).toBe("x");
				expect(expr.body.type).toBe("projection");
				expect(expr.body.label).toBe(y);
				expect(expr.body.term).toMatchObject({ type: "var", variable: x });
			});

			it("should parse a lambda with a projection and an application:\t\\x -> x.y z", () => {
				const src = `\\x -> x.y z`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const x = { type: "name", value: "x" };
				const y = "y";
				const z = { type: "name", value: "z" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("lambda");
				expect(expr.icit).toBe("Explicit");
				expect(expr.variable).toBe("x");
				expect(expr.body.type).toBe("application");
				expect(expr.body.arg).toMatchObject({ type: "var", variable: z });
				expect(expr.body.fn.type).toBe("projection");
				expect(expr.body.fn.label).toBe(y);
				expect(expr.body.fn.term).toMatchObject({ type: "var", variable: x });
			});

			it("should parse a lambda with a chain projection and an application:\t\\x -> x.y.z w", () => {
				const src = `\\x -> x.y.z w`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const x = { type: "name", value: "x" };
				const y = "y";
				const z = "z";
				const w = { type: "name", value: "w" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("lambda");
				expect(expr.icit).toBe("Explicit");
				expect(expr.variable).toBe("x");
				expect(expr.body.type).toBe("application");
				expect(expr.body.arg).toMatchObject({ type: "var", variable: w });
				expect(expr.body.fn.type).toBe("projection");
				expect(expr.body.fn.label).toBe(z);
				expect(expr.body.fn.term.type).toBe("projection");
				expect(expr.body.fn.term.label).toBe(y);
				expect(expr.body.fn.term.term).toMatchObject({ type: "var", variable: x });
			});

			it("should parse a lambda with an annotation:\t\\x -> y : Int -> Int", () => {
				const src = `\\x -> y : Int -> Int`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const y = { type: "name", value: "y" };
				const int = { type: "name", value: "Int" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("annotation");
				expect(expr.term.type).toBe("lambda");
				expect(expr.term.variable).toBe("x");
				expect(expr.term.body).toMatchObject({ type: "var", variable: y });
				expect(expr.ann.type).toBe("arrow");
				expect(expr.ann.lhs).toMatchObject({ type: "var", variable: int });
				expect(expr.ann.rhs).toMatchObject({ type: "var", variable: int });
			});

			it("should parse pi types with applications:\t(a:Type) -> (b:Type) -> f a -> f b", () => {
				const src = `(a:Type) -> (b:Type) -> f a -> f b`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const a = { type: "name", value: "a" };
				const b = { type: "name", value: "b" };
				const f = { type: "name", value: "f" };
				const type = { type: "Atom", value: "Type" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("pi");
				expect(expr.variable).toBe("a");
				expect(expr.annotation).toMatchObject({ type: "lit", value: type });
				expect(expr.body.type).toBe("pi");
				expect(expr.body.variable).toBe("b");
				expect(expr.body.annotation).toMatchObject({ type: "lit", value: type });
				expect(expr.body.body.type).toBe("arrow");
				expect(expr.body.body.lhs).toMatchObject({ type: "application" });
				expect(expr.body.body.lhs.fn).toMatchObject({ type: "var", variable: f });
				expect(expr.body.body.lhs.arg).toMatchObject({ type: "var", variable: a });
				expect(expr.body.body.rhs).toMatchObject({ type: "application" });
				expect(expr.body.body.rhs.fn).toMatchObject({ type: "var", variable: f });
				expect(expr.body.body.rhs.arg).toMatchObject({ type: "var", variable: b });
			});

			it("should parse pi types with row terms:\t(a:Type) -> (b:Type) -> { x:: a, y:: b }", () => {
				const src = `(a:Type) -> (b:Type) -> { x:: a, y:: b }`;
				const data = parser.feed(src);

				const expr = data.results[0];

				const a = { type: "name", value: "a" };
				const b = { type: "name", value: "b" };
				const type = { type: "Atom", value: "Type" };

				expect(data.results.length).toBe(1);
				expect(expr.type).toBe("pi");
				expect(expr.variable).toBe("a");
				expect(expr.annotation).toMatchObject({ type: "lit", value: type });
				expect(expr.body.type).toBe("pi");
				expect(expr.body.variable).toBe("b");
				expect(expr.body.annotation).toMatchObject({ type: "lit", value: type });
				expect(expr.body.body.type).toBe("schema");
				expect(expr.body.body.row.type).toBe("extension");
				expect(expr.body.body.row.label).toBe("x");
				expect(expr.body.body.row.value).toMatchObject({ type: "var", variable: a });
				expect(expr.body.body.row.row.type).toBe("extension");
				expect(expr.body.body.row.row.label).toBe("y");
				expect(expr.body.body.row.row.value).toMatchObject({ type: "var", variable: b });
				expect(expr.body.body.row.row.row.type).toBe("empty");
			});
		});
	});

	describe("Provenance", () => {
		beforeEach(() => {
			parser.grammar.start = "Ann";
		});

		it("should parse a number and track the location", () => {
			const src = `1`;
			const data = parser.feed(src);

			const expr = data.results[0];

			expect(data.results.length).toBe(1);
			expect(expr.location).toMatchObject({ from: { column: 1, line: 1 } });
		});

		it("should parse a lambda and track the location span", () => {
			const src = `\\x -> 1`;
			const data = parser.feed(src);

			const expr = data.results[0];

			expect(data.results.length).toBe(1);
			expect(expr.location).toMatchObject({ from: { column: 2, line: 1 }, to: { column: 7, line: 1 } });
		});

		it("should parse a match expression and track the location span across newlines", () => {
			const src = `match x
				| 1 -> 10
				| y -> 20`;
			const data = parser.feed(src);

			const expr = data.results[0];

			expect(data.results.length).toBe(1);
			expect(expr.location).toMatchObject({ from: { column: 1, line: 1 }, to: { column: 12, line: 3 } });
		});
	});
});
