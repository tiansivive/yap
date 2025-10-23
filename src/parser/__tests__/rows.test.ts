import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

const mkParser = (start: string = "Ann") => {
	const g = { ...Grammar, ParserStart: start } as typeof Grammar;
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

describe("parser: rows", () => {
	let parser: Nearley.Parser;
	beforeEach(() => {
		parser = mkParser("Ann");
	});
	afterEach(() => {
		parser.finish();
	});

	it("row extension: [ x: 2 ]", () => {
		const data = parser.feed("[ x: 2 ]");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("row polymorphic: [ x: 1 | r ]", () => {
		const data = parser.feed("[ x: 1 | r ]");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("struct: { x: 1, y: 2 }", () => {
		const data = parser.feed("{ x: 1, y: 2 }");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("struct polymorphic: { x: 1 | r }", () => {
		const data = parser.feed("{ x: 1 | r }");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("variant: | #x 1 | #y 2", () => {
		const data = parser.feed("| #x 1 | #y 2");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("tagged: #x 1", () => {
		const data = parser.feed("#x 1");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("tuple: {1, 2}", () => {
		const data = parser.feed("{1, 2}");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("tuple with tail: {1, 2 | r}", () => {
		const data = parser.feed("{1, 2 | r}");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("projection: x.y", () => {
		const data = parser.feed("x.y");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("shorthand projection: .x", () => {
		const data = parser.feed(".x");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("injection: { x | y = 1 }", () => {
		const data = parser.feed("{ x | y = 1 }");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("shorthand injection: { | y = 1 }", () => {
		const data = parser.feed("{ | y = 1 }");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});
});
