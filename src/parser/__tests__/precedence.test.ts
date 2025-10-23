import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

const mkParser = (start: string = "Ann") => {
	const g = { ...Grammar, ParserStart: start } as typeof Grammar;
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

describe("parser: precedence", () => {
	let parser: Nearley.Parser;
	beforeEach(() => {
		parser = mkParser("Ann");
	});
	afterEach(() => {
		parser.finish();
	});

	it("lambda with application: \\x -> f x", () => {
		const data = parser.feed("\\x -> f x");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("projection with application: x.y z", () => {
		const data = parser.feed("x.y z");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("lambda with projection: \\x -> x.y", () => {
		const data = parser.feed("\\x -> x.y");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("lambda with projection and application: \\x -> x.y z", () => {
		const data = parser.feed("\\x -> x.y z");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("lambda with chained projection and application: \\x -> x.y.z w", () => {
		const data = parser.feed("\\x -> x.y.z w");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("lambda with annotation: \\x -> y : Int -> Int", () => {
		const data = parser.feed("\\x -> y : Int -> Int");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("pi with applications: (a:Type) -> (b:Type) -> f a -> f b", () => {
		const data = parser.feed("(a:Type) -> (b:Type) -> f a -> f b");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("pi with row terms: (a:Type) -> (b:Type) -> { x: a, y: b }", () => {
		const data = parser.feed("(a:Type) -> (b:Type) -> { x: a, y: b }");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});
});
