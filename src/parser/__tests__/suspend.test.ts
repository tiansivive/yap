import { describe, expect, it } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";
import { display } from "../pretty";

describe("Parser: suspend", () => {
	it.each(["suspend @Ask !", "suspend @r.Ask 1", "suspend @(choose !) (f 1)", "suspend @(E @Num) x"])("parses %s", source => {
		const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled({ ...Grammar, ParserStart: "Ann" }));
		const { results } = parser.feed(source);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ type: "suspend", identity: expect.any(Object), term: expect.any(Object) });
		expect(results[0]).toMatchSnapshot();
	});
	it.each([
		"f (suspend @E x)",
		"(suspend @E f) x",
		"suspend @E (f x)",
		"f @(suspend @E x)",
		"suspend @r.E x",
		"suspend @(choose !) x",
		"suspend @(E @Num) x",
		"suspend @E f @a",
		"suspend f @a",
		"suspend @E reset @F x",
		"suspend @E reset x",
		"suspend [1]",
	])("preserves grouping in %s", source => {
		const parse = (text: string) => {
			const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled({ ...Grammar, ParserStart: "Ann" }));
			const { results } = parser.feed(text);
			expect(results).toHaveLength(1);
			return results[0];
		};
		const term = parse(source);
		const withoutLocations = (value: unknown) => JSON.stringify(value, (key, field: unknown) => (key === "location" ? undefined : field));
		expect(withoutLocations(parse(display(term)))).toEqual(withoutLocations(term));
	});
});
