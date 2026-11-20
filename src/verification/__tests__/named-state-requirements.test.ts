import assert from "node:assert";
import { describe, expect, it } from "vitest";

import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { runNF } from "../../elaboration/inference/__tests__/util";
import { VerificationServiceV2 } from "../V2/service";
import { Validity } from "../validity";

describe("Written named-state requirements", () => {
	it.each([
		["Ask", "", "ask", "valid"],
		["Tell", "", "ask", "invalid"],
		["Ask", String.raw`with Ask: (\p k -> k 7) in ask !`, "served", "valid"],
		["Ask", "ask !", "served", "invalid"],
		["Ask", String.raw`with Tell: (\p k -> k 7) in ask !`, "served", "invalid"],
	] as const)("checks requirement %s with call %s", (identity, call, name, expected) => {
		const source = String.raw`
foreign Ask: Effect Unit Num;
foreign Tell: Effect Unit Num;
let ask: (st |- u: Unit [| \value -> live st ${identity} |]) -> Num = \u -> suspend @Ask u;
${call ? `let served = ${call};` : ""}
`;
		const declaration = elaborateModule(source).declarations.find(declaration => declaration.name === name);
		assert(declaration);
		const { elaborated, error } = declaration;
		assert(elaborated, error);
		const { tm, ty, ctx, registry } = elaborated;
		const { answer } = VerificationServiceV2().letdec(name, tm, ty, ctx, registry);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer.vc).tag).toBe(expected);
	});

	it("scopes the named state over the parameter and result while preserving their written predicates", () => {
		const declaration = elaborateModule(String.raw`
foreign Ask: Effect Unit Num;
let ask: (st |- u: Unit [| \value -> live st Ask |]) -> Num [| \value -> live st Ask |] = \u -> 7;
`).declarations.find(({ name }) => name === "ask");
		assert(declaration?.elaborated, declaration?.error);
		const { ty, ctx, registry } = declaration.elaborated;
		const type = runNF(ctx, () => NF.quote(ctx.env.length, ty), registry);
		expect(type).toMatchObject({
			type: "Abs",
			binding: {
				type: "Psi",
				variable: "st",
				requirement: undefined,
			},
			body: { type: "Abs", binding: { type: "Pi", annotation: { type: "Modal" } }, body: { type: "Modal" } },
		});
	});
});
