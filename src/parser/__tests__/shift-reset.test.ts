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
		const src = "reset 10 with \\k -> k 5";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const result = data.results[0];
		expect(result.type).toBe("reset");
		expect(result.handler.type).toBe("lambda");
		expect(result.term.type).toBe("lit");
	});

	it("should parse shift with value", () => {
		const parser = mkParser();
		const src = "shift 42 \\p -> p";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const result = data.results[0];
		expect(result.type).toBe("shift");
		expect(result.term.type).toBe("lit");
	});

	it("should parse shift with explicit binder", () => {
		const parser = mkParser();
		const src = "shift 1 \\p -> { return p; }";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const result = data.results[0];
		expect(result.type).toBe("shift");
		expect(result.term.type).toBe("lit");
		expect(result.continuation.type).toBe("lambda");
	});

	it("should parse reset with multi-param handler", () => {
		const parser = mkParser();
		const src = "reset shift 1 \\p -> p with \\k v -> k v";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const result = data.results[0];
		expect(result.type).toBe("reset");
	});

	it("should parse shift in application", () => {
		const parser = mkParser();
		const src = "shift (1 + 2) \\p -> p";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const shift = data.results[0];
		expect(shift.type).toBe("shift");
	});
});
