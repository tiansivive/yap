import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Pattern matching — polymorphic generalization", () => {
	const typeOf = (src: string) => {
		const result = runScript(src);
		const type = result.declarations[0]?.stages?.type ?? "";
		// The inferred type must be fully elaborated: no unsolved metas (?N) and no `Any` smell.
		expect(type).toBeTruthy();
		expect(type).not.toMatch(/\?\d/);
		expect(type).not.toMatch(/\bAny\b/);
		return result;
	};

	test("variant match with unconstrained payloads", () => {
		const result = typeOf(`\\x -> match x | #nil a -> 0 | #cons {el, rest} -> 1`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("single-arm variant with unused payload", () => {
		const result = typeOf(`\\x -> match x | #nil a -> 0`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("variant match that returns the payload", () => {
		const result = typeOf(`\\x -> match x | #some v -> v`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("struct pattern with unconstrained binders", () => {
		const result = typeOf(`\\x -> match x | { foo: y, bar: z } -> 0`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("wildcard variant match", () => {
		const result = typeOf(`\\x -> match x | #nil _ -> 0 | #cons _ -> 1`);
		expect(snap(result)).toMatchSnapshot();
	});
});
