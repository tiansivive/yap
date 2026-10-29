import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

const mkParser = (start: string = "Ann") => {
	const g = { ...Grammar, ParserStart: start };
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

describe("parser: variables", () => {
	let parser: Nearley.Parser;
	beforeEach(() => {
		parser = mkParser("Ann");
	});
	afterEach(() => {
		parser.finish();
	});

	it("variable: x", () => {
		const data = parser.feed("x");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("dep-label: &foo", () => {
		const data = parser.feed("&foo");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("nu-label: $foo", () => {
		const data = parser.feed("$foo");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("dep-label in struct field: { n: 1, vec: &n }", () => {
		const data = parser.feed("{ n: 1, vec: &n }");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("nu-label in struct field: { a: 1, b: $a }", () => {
		const data = parser.feed("{ a: 1, b: $a }");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});
});
