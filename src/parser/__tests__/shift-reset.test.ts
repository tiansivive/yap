import { describe, it, expect, beforeEach } from "vitest";
import Nearley from "nearley";
import Grammar from "@yap/src/grammar";

describe("Parser: Shift/Reset", () => {
	let parser: Nearley.Parser;

	beforeEach(() => {
		const g = { ...Grammar, ParserStart: "Ann" } as typeof Grammar;
		parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
	});

	describe("reset syntax", () => {
		it("parse simple reset", () => {
			const src = "reset h e";
			const data = parser.feed(src);

			expect(data.results).toHaveLength(1);
			const result = data.results[0];
			expect(result).toMatchObject({
				type: "reset",
			});
			expect({ result }).toMatchSnapshot();
		});

		it("parse reset with lambda handler", () => {
			const src = "reset (\\k v -> k v) body";
			const data = parser.feed(src);

			expect(data.results).toHaveLength(1);
			const result = data.results[0];
			expect(result.type).toBe("reset");
			expect(result.handler.type).toBe("lambda");
			expect({ result }).toMatchSnapshot();
		});

		it("parse nested reset", () => {
			const src = "reset h1 (reset h2 e)";
			const data = parser.feed(src);

			expect(data.results).toHaveLength(1);
			const result = data.results[0];
			expect(result.type).toBe("reset");
			expect(result.body.type).toBe("reset");
			expect({ result }).toMatchSnapshot();
		});
	});

	describe("shift syntax", () => {
		it("parse simple shift", () => {
			const src = "shift v";
			const data = parser.feed(src);

			expect(data.results).toHaveLength(1);
			const result = data.results[0];
			expect(result).toMatchObject({
				type: "shift",
			});
			expect({ result }).toMatchSnapshot();
		});

		it("parse shift with literal", () => {
			const src = "shift 42";
			const data = parser.feed(src);

			expect(data.results).toHaveLength(1);
			const result = data.results[0];
			expect(result.type).toBe("shift");
			expect({ result }).toMatchSnapshot();
		});
	});

	describe("reset with shift", () => {
		it("parse reset containing shift", () => {
			const src = "reset h (shift v)";
			const data = parser.feed(src);

			expect(data.results).toHaveLength(1);
			const result = data.results[0];
			expect(result.type).toBe("reset");
			expect(result.body.type).toBe("shift");
			expect({ result }).toMatchSnapshot();
		});

		it("parse complex reset/shift expression", () => {
			const src = "reset (\\k v -> k v) (shift 1)";
			const data = parser.feed(src);

			expect(data.results).toHaveLength(1);
			const result = data.results[0];
			expect(result.type).toBe("reset");
			expect({ result }).toMatchSnapshot();
		});
	});
});
