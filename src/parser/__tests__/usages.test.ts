import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

const mkParser = (start: string = "Ann") => {
	const g = { ...Grammar, ParserStart: start } as typeof Grammar;
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

describe("parser: usage annotations (multiplicities)", () => {
	let parser: Nearley.Parser;
	beforeEach(() => {
		parser = mkParser("Ann");
	});
	afterEach(() => {
		parser.finish();
	});

	it("linear usage: <1> Num", () => {
		const data = parser.feed("<1> Num");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("zero usage: <0> Num", () => {
		const data = parser.feed("<0> Num");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("unrestricted usage: <*> Num", () => {
		const data = parser.feed("<*> Num");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("usage with refinement: <1> Num [|\\n -> n > 0|]", () => {
		const data = parser.feed("<1> Num [|\\n -> n > 0|]");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("usage in function type: <1> Num -> Num", () => {
		const data = parser.feed("<1> Num -> Num");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("usage in pi type: <1> (x: Num) -> Num", () => {
		const data = parser.feed("<1> (x: Num) -> Num");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("usage with struct: <*> { x: Num, y: String }", () => {
		const data = parser.feed("<*> { x: Num, y: String }");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("combined usage and refinement: <1> Num [|\\n -> n >= 0|]", () => {
		const data = parser.feed("<1> Num [|\\n -> n >= 0|]");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});
});
