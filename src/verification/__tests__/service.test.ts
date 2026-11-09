import assert from "node:assert";
import { describe, expect, it } from "vitest";
import { match } from "ts-pattern";

import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { VerificationServiceV2 } from "../V2/service";
import { Build } from "../solver/ivl/build";
import { Validity } from "../validity";

describe("Verification scope", () => {
	it("retains the parameter in a local binding's refinement", () => {
		const vc = checked(String.raw`let compute: Num -> Num = \input -> { let doubled = input * 2; return doubled; };`);

		expect(vc).toMatchObject({
			tag: "Forall",
			binders: [{ name: "input" }],
			body: {
				tag: "Forall",
				binders: [{ name: "doubled" }],
				body: {
					tag: "Implies",
					left: Build.atom("=", Build.var_("doubled", Build.Real), Build.arith("*", Build.const_("input", Build.Real), Build.num(2, Build.Real), Build.Real)),
				},
			},
		});
		expect(Validity.check(vc).tag).toBe("valid");
	});

	it("resolves a recursive reference at the declaration's binder", () => {
		const vc = checked(String.raw`let again: Num -> Num = \input -> again input;`);

		expect(Validity.check(vc).tag).toBe("valid");
	});

	it.each([
		["input", "valid"],
		["0", "invalid"],
	] as const)("checks a dependent result contract for %s", (body, expected) => {
		const vc = checked(String.raw`let same: (input: Num) -> Num [| \result -> result == input |] = \input -> ${body};`);

		expect(Validity.check(vc).tag).toBe(expected);
	});

	it("checks an expression in its elaborated scope", () => {
		const vc = checked(String.raw`(\(input: Num) -> input);`);

		expect(Validity.check(vc).tag).toBe("valid");
	});
});

const checked = (source: string) => {
	const [{ name, kind, elaborated, error }] = elaborateModule(source).declarations;
	assert(elaborated, error);
	const { tm, ty, ctx, registry } = elaborated;
	const svc = VerificationServiceV2();
	const { answer } = match(kind)
		.with("let", () => svc.letdec(name, tm, ty, ctx, registry))
		.otherwise(() => svc.check(tm, ty, ctx, registry));
	assert(!Eff.failed(answer));
	return answer.vc;
};
