import { describe, expect, it } from "vitest";
import * as DSL from "../../../ivl/dsl";
import { Normalize } from "../index";

describe("Arithmetic normalization", () => {
	it("normalizes x <= 5", () => {
		const result = Normalize.atom({ op: "<=", args: [DSL.x, DSL.int(5)] });
		expect(result.tag).toBe("linear");
	});

	it("normalizes x + y > 3", () => {
		const result = Normalize.atom({ op: ">", args: [DSL.add(DSL.x, DSL.y), DSL.int(3)] });
		expect(result.tag).toBe("linear");
	});

	it("rejects nonlinear x * y", () => {
		const result = Normalize.atom({ op: "<=", args: [DSL.mul(DSL.x, DSL.y), DSL.int(5)] });
		expect(result.tag).toBe("nonlinear");
	});

	it("linearizes constant times variable", () => {
		const result = Normalize.atom({ op: "<=", args: [DSL.mul(DSL.int(3), DSL.x), DSL.int(9)] });
		expect(result.tag).toBe("linear");
	});
});
