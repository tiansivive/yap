import { describe, expect, it } from "vitest";
import { match, P } from "ts-pattern";
import { Build } from "../../../ivl/build";
import * as DSL from "../../../ivl/dsl";
import * as EUF from "../index";

describe("EUF term interning", () => {
	it("reuses the same enode for identical variables", () => {
		const first = EUF.Intern.term(EUF.Intern.empty, DSL.x);
		const second = EUF.Intern.term(first.state, DSL.x);

		expect(second.id).toBe(first.id);
		expect(second.state.nodes.size).toBe(1);
	});

	it("interns applications after their arguments", () => {
		const expectedNodes = 2;
		const term = Build.app("f", [DSL.x], Build.Int);
		const result = EUF.Intern.term(EUF.Intern.empty, term);

		expect(result.state.nodes.size).toBe(expectedNodes);
		match(EUF.Intern.find(result.state, "x", []))
			.with(P.number, x => expect(EUF.Intern.find(result.state, "f", [x])).toBe(result.id))
			.with(undefined, () => expect.fail("x should be interned before f(x)"))
			.exhaustive();
	});

	it("threads state while interning term pairs", () => {
		const pair = EUF.Intern.pair(EUF.Intern.empty, DSL.x, DSL.y);

		expect(pair.left).not.toBe(pair.right);
		expect(pair.state.nodes.size).toBe(2);
	});

	it("exposes Arena.empty as the shared empty interning state", () => {
		expect(EUF.Arena.empty).toBe(EUF.Intern.empty);
	});
});
