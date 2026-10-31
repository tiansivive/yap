import { describe, expect, it } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

describe("effect expressions", () => {
	it.each([
		"with Exn: h in capture [Exn] 1",
		"with Exn: (\\e k -> 0), Ask: (\\p k -> k 1) in capture [Ask] !",
		"with Exn: h in { let x = 1; return capture [Exn] x; }",
		"capture [r.Exn] 1",
		"reset (capture (\\k -> resume 1))",
	])("parses one expression: %s", source => {
		const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled({ ...Grammar, ParserStart: "Ann" }));
		parser.feed(source);
		expect(parser.results).toHaveLength(1);
		expect(parser.results[0].type).toMatch(/with|capture|reset/);
	});
});
