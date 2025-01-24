import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Nearley from "nearley";
import Grammar from "./grammar";

import * as Ctor from "./src";

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
			parser.grammar.start = "Expr";
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
			it("should parse empty row terms:\t{}", () => {
				const src = `{}`;
				const data = parser.feed(src);

				const empty = Ctor.Row({ type: "empty" });

				expect(data.results.length).toBe(1);
				expect(data.results[0]).toStrictEqual(empty);
			});

			it("should parse row terms:\t\t{ x: 1, y: 2 }", () => {
				const src = `{ x: 1, y: 2 }`;
				const data = parser.feed(src);

				const xVal = Ctor.num(1);
				const yVal = Ctor.num(2);

				const row = data.results[0];

				const empty: Ctor.Row = { type: "empty" };
				const y: Ctor.Row = { type: "extension", label: "y", value: yVal, rest: empty };
				const x: Ctor.Row = { type: "extension", label: "x", value: xVal, rest: y };
				const expected = Ctor.Row(x);

				expect(data.results.length).toBe(1);
				expect(row).toStrictEqual(expected);
			});
		});
	});
});
