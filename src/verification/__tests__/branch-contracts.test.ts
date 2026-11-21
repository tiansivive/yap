import assert from "node:assert";
import { isMatching } from "ts-pattern";
import { describe, expect, it } from "vitest";

import * as NF from "@yap/elaboration/normalization";
import * as Horn from "../horn";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { VerificationServiceV2 } from "../V2/service";
import { Validity } from "../validity";

describe("Branch contracts", () => {
	it.each([
		[String.raw`with Ask: (\p k -> k 7) in ask !`, "0", "valid"],
		[String.raw`with Ask: (\p k -> k 7) in ask !`, "ask !", "invalid"],
		[String.raw`with Tell: (\p k -> k 7) in ask !`, "0", "invalid"],
	] as const)("checks branch-local handlers in %s / %s", (yes, no, expected) => {
		expect(verify(String.raw`let served: Bool -> Num = \b -> match b | true -> ${yes} | false -> ${no};`)).toBe(expected);
	});

	it.each([
		["Bool", "invalid"],
		[String.raw`Bool [| \b -> b |]`, "valid"],
	] as const)("uses branch facts under the parameter contract %s", (parameter, expected) => {
		expect(verify(String.raw`let served: ${parameter} -> Num = \b -> match b | true -> 0 | false -> ask !;`)).toBe(expected);
	});

	it("emits each callback argument constraint under its own match guard", () => {
		const [guarded] = elaborateModule(
			String.raw`let guarded: (get: String -> Num) -> Bool -> Num = \get b -> match b | true -> get "yes" | false -> get "no";`,
		).declarations;
		assert(guarded.elaborated, guarded.error);
		const { tm, ty, ctx, registry } = guarded.elaborated;
		const { answer, constraints } = VerificationServiceV2().letdec("guarded", tm, ty, ctx, registry);
		assert(!Eff.failed(answer));

		const unwrap = (value: NF.Value) => NF.unwrapNeutral(NF.unglue(value));
		const uses = constraints.flatMap(({ goal, binders }) => {
			const app = unwrap(goal);
			if (!isMatching(NF.Patterns.App, app)) {
				return [];
			}
			const meta = unwrap(app.func);
			const literals = binders
				.flatMap(b => (b.premise ? Horn.conjuncts(b.premise) : []))
				.map(unwrap)
				.flatMap(eq => (eq.type === "External" && eq.name === "$eq" ? eq.args : []))
				.map(unwrap)
				.flatMap(arg => (arg.type === "Lit" ? [arg.value] : []));
			return isMatching(NF.Patterns.Flex, meta) && literals.some(l => l.type === "String") ? [{ id: meta.variable.val, literals }] : [];
		});
		expect(uses).toHaveLength(2);
		expect(uses[0].id).toBe(uses[1].id);
		expect(uses.map(u => u.literals)).toEqual([
			[
				{ type: "Bool", value: true },
				{ type: "String", value: "yes" },
			],
			[
				{ type: "Bool", value: false },
				{ type: "String", value: "no" },
			],
		]);
	});
});

const verify = (declaration: string) => {
	const result = elaborateModule(String.raw`
foreign Ask: Effect Unit Num;
foreign Tell: Effect Unit Num;
let ask: (st |- u: Unit [| \value -> live st Ask |]) -> Num = \u -> suspend @Ask u;
${declaration}
`).declarations.find(({ name }) => name === "served");
	assert(result?.elaborated, result?.error);
	const { tm, ty, ctx, registry } = result.elaborated;
	const { answer } = VerificationServiceV2().letdec("served", tm, ty, ctx, registry);
	assert(!Eff.failed(answer));
	return Validity.check(answer.vc).tag;
};
