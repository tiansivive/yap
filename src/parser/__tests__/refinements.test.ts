import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

const mkParser = (start: string = "Ann") => {
	const g = { ...Grammar, ParserStart: start } as typeof Grammar;
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

describe("parser: refinement types (liquid types)", () => {
	let parser: Nearley.Parser;
	beforeEach(() => {
		parser = mkParser("Ann");
	});
	afterEach(() => {
		parser.finish();
	});

	it("simple refinement: Num [|\\n -> n > 0|]", () => {
		const data = parser.feed("Num [|\\n -> n > 0|]");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("refinement with equality: x [|\\v -> v == 42|]", () => {
		const data = parser.feed("x [|\\v -> v == 42|]");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("refinement with inequality: Num [|\\n -> n >= 0|]", () => {
		const data = parser.feed("Num [|\\n -> n >= 0|]");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("refinement with complex predicate: t [|\\x -> x > 0 == true|]", () => {
		const data = parser.feed("t [|\\x -> x > 0 == true|]");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("nested type with refinement: { x: Num [|\\n -> n > 0|] }", () => {
		const data = parser.feed("{ x: Num [|\\n -> n > 0|] }");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("function returning refinement: Num -> Num [|\\v -> v > 0|]", () => {
		const data = parser.feed("Num -> Num [|\\v -> v > 0|]");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("refinement in pi type: (x: Num) -> Num [|\\v -> v > x|]", () => {
		const data = parser.feed("(x: Num) -> Num [|\\v -> v > x|]");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});
});
