import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";
import { display } from "../pretty";

const mkParser = (start: string = "Ann") => {
	const g = { ...Grammar, ParserStart: start };
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

describe("parser: literals", () => {
	let parser: Nearley.Parser;
	beforeEach(() => {
		parser = mkParser("Ann");
	});
	afterEach(() => {
		parser.finish();
	});

	it("number: 1", () => {
		const data = parser.feed("1");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it('string: "hello"', () => {
		const data = parser.feed('"hello"');
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("boolean: true", () => {
		const data = parser.feed("true");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("unit: !", () => {
		const data = parser.feed("!");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
		const printed = mkParser().feed(display(data.results[0]));
		expect(printed.results).toHaveLength(1);
		expect(printed.results[0]).toEqual(data.results[0]);
	});

	it("Row", () => {
		const data = parser.feed("Row");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("Type", () => {
		const data = parser.feed("Type");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});
});
