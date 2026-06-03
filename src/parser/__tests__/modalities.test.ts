import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

const mkParser = (start: string = "Ann") => {
	const g = { ...Grammar, ParserStart: start } as typeof Grammar;
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

describe("parser: gram annotations (%rule syntax)", () => {
	let parser: Nearley.Parser;
	beforeEach(() => {
		parser = mkParser("Ann");
	});
	afterEach(() => {
		parser.finish();
	});

	it("gram only: Num %myRule", () => {
		const data = parser.feed("Num %myRule");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("quantity + gram: <1> Num %myRule", () => {
		const data = parser.feed("<1> Num %myRule");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("liquid + gram: Num [|\\n -> n > 0|] %myRule", () => {
		const data = parser.feed("Num [|\\n -> n > 0|] %myRule");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("quantity + liquid + gram: <1> Num [|\\n -> n > 0|] %myRule", () => {
		const data = parser.feed("<1> Num [|\\n -> n > 0|] %myRule");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});

	it("gram in function return: Num -> Num %outputRule", () => {
		const data = parser.feed("Num -> Num %outputRule");
		expect(data.results.length).toBe(1);
		expect(data.results[0]).toMatchSnapshot();
	});
});
