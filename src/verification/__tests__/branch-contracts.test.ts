import assert from "node:assert";
import { isMatching } from "ts-pattern";
import * as NF from "@yap/elaboration/normalization";
import { conjuncts } from "../horn";
import { describe, expect, it } from "vitest";

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

		const uses = constraints.flatMap(({ binders, premises, goal }) => {
			if (goal.type !== "App") {
				return [];
			}
			const head = NF.unwrapNeutral(goal.func);
			const arg = NF.unwrapNeutral(goal.arg);
			if (
				!isMatching(NF.Patterns.Flex, head) ||
				!isMatching(NF.Patterns.Rigid, arg) ||
				!binders.some(p => p.lvl === arg.variable.lvl && isMatching({ ...NF.Patterns.Atom, value: { value: "String" } }, p.annotation))
			) {
				return [];
			}
			const guards = premises.flatMap(conjuncts).filter(g => g.type === "External");
			return [{ kappa: head.variable.val, guards }];
		});
		expect(uses).toHaveLength(2);
		expect(uses[0].kappa).toBe(uses[1].kappa);
		expect(uses.map(({ guards }) => guards)).toMatchObject(
			[
				[true, "yes"],
				[false, "no"],
			].map(([value, key]) => [
				{ name: "$eq" },
				{ name: "$eq", args: [{ value: NF.Patterns.Rigid }, { value: { type: "Bool", value } }] },
				{ name: "$eq", args: [{ value: NF.Patterns.Rigid }, { value: { type: "String", value: key } }] },
			]),
		);
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
