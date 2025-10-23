import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

const mkParser = (start: string = "Ann") => {
	const g = { ...Grammar, ParserStart: start } as typeof Grammar;
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

describe("parser: pattern matching", () => {
	let parser: Nearley.Parser;
	beforeEach(() => {
		parser = mkParser("Ann");
	});
	afterEach(() => {
		parser.finish();
	});

	it("match with literals and variable branches", () => {
		const src = `match x\n  | 1 -> 10\n  | y -> "hello"`;
		const data = parser.feed(src);
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("match with variants", () => {
		const src = `match x\n  | #x 1 -> 10\n  | #y 2 -> 20`;
		const data = parser.feed(src);
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("match with structs", () => {
		const src = `match x\n  | { x: 1, y: 2 } -> 10\n  | { x: 2, y: 1 } -> 20`;
		const data = parser.feed(src);
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});
});
