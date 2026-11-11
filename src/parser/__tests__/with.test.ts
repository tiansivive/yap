import { describe, expect, it } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";
import { display } from "../pretty";

describe("Parser: with", () => {
	it.each([
		"with Ask: handler in suspend @Ask payload",
		"with Ask: first, Tell: second in body",
		"with Ask: first in with Tell: second in body",
		"with (make x): handler in body",
		"f (with Ask: handler in body)",
		"(with Ask: handler in f) x",
		"f @(with Ask: handler in body)",
	])("parses and preserves grouping in %s", source => {
		const parse = (source: string) => {
			const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled({ ...Grammar, ParserStart: "Ann" }));
			const { results } = parser.feed(source);
			expect(results).toHaveLength(1);
			return results[0];
		};
		const term = parse(source);
		expect(term).toMatchSnapshot();
		const withoutLocations = (value: unknown) => JSON.stringify(value, (key, field: unknown) => (key === "location" ? undefined : field));
		expect(withoutLocations(parse(display(term)))).toEqual(withoutLocations(term));
	});
	it("parses and displays a handler and identity lambda", () => {
		const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled({ ...Grammar, ParserStart: "Ann" }));
		const { results } = parser.feed("with (\\(a: Type) => Ask): (\\p k -> k 42) in suspend @Ask !");
		expect(results).toHaveLength(1);
		expect({ term: results[0], display: display(results[0]) }).toMatchSnapshot();
	});
});
