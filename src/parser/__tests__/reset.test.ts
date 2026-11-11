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
		"suspend [E] x",
		"reset (suspend (\\k -> k 1))",
		"suspend makeHandler !",
		"suspend match flag | true -> h | false -> h",
	])("parses anonymous %s", source => {
		const term = parse(source);
		expect(semantic(term)).toMatchSnapshot();
		expect(term).toMatchObject({ type: expect.stringMatching(/^(reset|suspend)$/), term: expect.any(Object) });
		expect(term.identity).toBeUndefined();
	});
	it.each(["suspend", "reset"])("separates the identity from the implicit application in %s", keyword => {
		const named = parse(`${keyword} @E f @a`);
		const anonymous = parse(`${keyword} f @a`);
		expect(named).toMatchObject({
			identity: { type: "var", variable: { value: "E" } },
			term: { type: "application", icit: "Implicit", fn: { variable: { value: "f" } }, arg: { variable: { value: "a" } } },
		});
		expect(semantic(anonymous.term)).toEqual(semantic(named.term));
		expect(anonymous.identity).toBeUndefined();
	});
	it.each(["suspend", "reset"])("keeps explicit identity arguments inside parentheses in %s", keyword => {
		expect(parse(`${keyword} @(E @Num) x`)).toMatchObject({
			identity: { type: "application", icit: "Implicit", fn: { variable: { value: "E" } }, arg: { variable: { value: "Num" } } },
			term: { type: "var", variable: { value: "x" } },
		});
	});
	it.each(["reset @eff value", "suspend @eff value", "reset @eff f x + 1", "suspend @eff f x + 1"])("selects the identity in %s", source => {
		const term = parse(source);
		expect(semantic(term)).toMatchSnapshot();
		expect(term).toMatchObject({ identity: { type: "var", variable: { value: "eff" } }, term: expect.any(Object) });
	});
	it.each([
		"f (reset x)",
		"(reset x) y",
		"f @(reset @E x)",
		"reset @E (f x)",
		"suspend (f x)",
		"f (suspend x)",
		"reset @r.E x",
		"reset @(choose !) x",
		"reset @(E @Num) x",
		"reset @E f @a",
		"reset f @a",
		"reset @E suspend @F x",
		"reset suspend @E x",
		"reset @E suspend x",
		"reset [1]",
		"reset [E] x",
	])("preserves grouping in %s", source => {
		const term = parse(source);
		const withoutLocations = (value: unknown) => JSON.stringify(value, (key, field: unknown) => (key === "location" ? undefined : field));
		expect(withoutLocations(parse(display(term)))).toEqual(withoutLocations(term));
	});
});
