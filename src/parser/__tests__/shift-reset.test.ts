import { describe, it, expect } from "vitest";
import Nearley from "nearley";
import Grammar from "../grammar";

describe("Parser: Shift/Reset", () => {
	const mkParser = () => {
		const g = { ...Grammar, ParserStart: "Ann" } as typeof Grammar;
		return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
	};

	it("should parse reset", () => {
		const parser = mkParser();
		const src = "reset 10";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const result = data.results[0];
		expect(result.type).toBe("reset");
		expect(result.term.type).toBe("lit");
	});

	it("should parse shift with simple body", () => {
		const parser = mkParser();
		const src = "shift (10)";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const result = data.results[0];
		expect(result.type).toBe("shift");
		expect(result.term.type).toBe("lit");
	});

	it("should parse shift with resumption", () => {
		const parser = mkParser();
		const src = "shift (resume 1)";
		const data = parser.feed(src);

		expect(data.results.length).toBe(1);
		const shift = data.results[0];
		expect(shift.type).toBe("shift");
	});
});
