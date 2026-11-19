import assert from "node:assert";
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
