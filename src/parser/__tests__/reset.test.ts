import { describe, expect, it } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";
import { display } from "../pretty";

const parse = (source: string) => {
	const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled({ ...Grammar, ParserStart: "Ann" }));
	const { results } = parser.feed(source);
	expect(results).toHaveLength(1);
	return results[0];
};

const semantic = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, field: unknown) => (key === "location" ? undefined : field)));

describe("Parser: raw control", () => {
	it.each([
		"reset 1 + 2",
		"reset [1]",
		"reset [1] ++ [2]",
		"reset ([f] x)",
		"reset [E] x",
		"capture [E] x",
		"reset (capture (\\k -> k 1))",
		"capture makeHandler !",
		"capture match flag | true -> h | false -> h",
	])("parses anonymous %s", source => {
		const term = parse(source);
		expect(semantic(term)).toMatchSnapshot();
		expect(term).toMatchObject({ type: expect.stringMatching(/^(reset|capture)$/), term: expect.any(Object) });
		expect(term.identity).toBeUndefined();
	});
	it.each(["capture", "reset"])("separates the identity from the implicit application in %s", keyword => {
		const named = parse(`${keyword} @E f @a`);
		const anonymous = parse(`${keyword} f @a`);
		expect(named).toMatchObject({
			identity: { type: "var", variable: { value: "E" } },
			term: { type: "application", icit: "Implicit", fn: { variable: { value: "f" } }, arg: { variable: { value: "a" } } },
		});
		expect(semantic(anonymous.term)).toEqual(semantic(named.term));
		expect(anonymous.identity).toBeUndefined();
	});
	it.each(["capture", "reset"])("keeps explicit identity arguments inside parentheses in %s", keyword => {
		expect(parse(`${keyword} @(E @Num) x`)).toMatchObject({
			identity: { type: "application", icit: "Implicit", fn: { variable: { value: "E" } }, arg: { variable: { value: "Num" } } },
			term: { type: "var", variable: { value: "x" } },
		});
	});
	it.each(["reset @eff value", "capture @eff value", "reset @eff f x + 1", "capture @eff f x + 1"])("selects the identity in %s", source => {
		const term = parse(source);
		expect(semantic(term)).toMatchSnapshot();
		expect(term).toMatchObject({ identity: { type: "var", variable: { value: "eff" } }, term: expect.any(Object) });
	});
	it.each([
		"f (reset x)",
		"(reset x) y",
		"f @(reset @E x)",
		"reset @E (f x)",
		"capture (f x)",
		"f (capture x)",
		"reset @r.E x",
		"reset @(choose !) x",
		"reset @(E @Num) x",
		"reset @E f @a",
		"reset f @a",
		"reset @E capture @F x",
		"reset capture @E x",
		"reset @E capture x",
		"reset [1]",
		"reset [E] x",
	])("preserves grouping in %s", source => {
		const term = parse(source);
		const withoutLocations = (value: unknown) => JSON.stringify(value, (key, field: unknown) => (key === "location" ? undefined : field));
		expect(withoutLocations(parse(display(term)))).toEqual(withoutLocations(term));
	});
});
