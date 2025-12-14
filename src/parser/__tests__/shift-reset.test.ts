import { describe, it, expect } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

describe("Parser: Shift/Reset", () => {
	const mkParser = () => {
		const g = { ...Grammar, ParserStart: "Ann" } as typeof Grammar;
		return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
	};

	it("should parse reset with handler and term", () => {
		const parser = mkParser();
		const src = "reset \\k -> k 5 10";
		const data = parser.feed(src);

		expect(data.results.length).toBeGreaterThanOrEqual(1);
		const result = data.results[0];
		expect(result.type).toBe("reset");
		expect(result.handler.type).toBe("lambda");
		expect(result.term.type).toBe("lit");
	});

	it("should parse shift with value", () => {
		const parser = mkParser();
		const src = "shift 42";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const result = data.results[0];
		expect(result.type).toBe("shift");
		expect(result.term.type).toBe("lit");
	});

	it("should parse reset with multi-param handler", () => {
		const parser = mkParser();
		const src = "reset \\k v -> k v shift 1";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const result = data.results[0];
		expect(result.type).toBe("reset");
	});

	it("should parse shift in application", () => {
		const parser = mkParser();
		const src = "shift 1 + 2";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
	});
});
