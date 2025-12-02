import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

const mkParser = (start: string = "Ann") => {
	const g = { ...Grammar, ParserStart: start } as typeof Grammar;
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

describe("parser: primitive operations", () => {
	let parser: Nearley.Parser;
	beforeEach(() => {
		parser = mkParser("Ann");
	});
	afterEach(() => {
		parser.finish();
	});

	it("addition: 1 + 2", () => {
		const data = parser.feed("1 + 2");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("subtraction: 5 - 3", () => {
		const data = parser.feed("5 - 3");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("multiplication: 4 * 2", () => {
		const data = parser.feed("4 * 2");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("division: 10 / 2", () => {
		const data = parser.feed("10 / 2");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("equality: x == y", () => {
		const data = parser.feed("x == y");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("inequality: x != y", () => {
		const data = parser.feed("x != y");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("less than or equal: x <= y", () => {
		const data = parser.feed("x <= y");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("greater than or equal: x >= y", () => {
		const data = parser.feed("x >= y");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("less than: x < y", () => {
		const data = parser.feed("x < y");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("greater than: x > y", () => {
		const data = parser.feed("x > y");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("pipe right: f |> g", () => {
		const data = parser.feed("f |> g");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("pipe left: f <| g", () => {
		const data = parser.feed("f <| g");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("concat: s1 <> s2", () => {
		const data = parser.feed("s1 <> s2");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("chained operations: 1 + 2 * 3", () => {
		const data = parser.feed("1 + 2 * 3");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("nested operations: (x + y) * z", () => {
		const data = parser.feed("(x + y) * z");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});
});
