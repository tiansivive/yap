import { describe, expect, it } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";
import { display } from "../pretty";

describe("Parser: capture", () => {
	it.each(["capture [Ask] !", "capture [r.Ask] 1", "capture [choose !] (f 1)"])("parses %s", source => {
		const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled({ ...Grammar, ParserStart: "Ann" }));
		const { results } = parser.feed(source);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ type: "capture", identity: expect.any(Object), term: expect.any(Object) });
		expect(results[0]).toMatchSnapshot();
	});
	it.each(["f (capture [E] x)", "(capture [E] f) x", "capture [E] (f x)", "f @(capture [E] x)"])("preserves grouping in %s", source => {
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
