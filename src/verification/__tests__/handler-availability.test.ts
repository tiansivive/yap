import assert from "node:assert";
import { beforeEach, describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { mkCtx, runNF } from "../../elaboration/inference/__tests__/util";
import { VerificationServiceV2 } from "../V2/service";
import { Validity } from "../validity";

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("Handler availability", () => {
	it.each([
		[String.raw`with Ask: (\payload k -> k 7) in suspend @Ask !`, "valid"],
		["suspend @Ask !", "invalid"],
	] as const)("checks the direct source expression %s", (body, expected) => {
		expect(verify(`foreign Ask: Effect Unit Num; let served = ${body};`)).toBe(expected);
	});

	it.each([
		[String.raw`with Tell: (\p k -> k 7) in suspend @Ask !`, "invalid"],
		[String.raw`with Ask: (\p k -> k 7) in with Tell: (\p k -> k 8) in suspend @Ask !`, "valid"],
		[String.raw`with Ask: (\p k -> k 7) in with Tell: (\p k -> k 8) in suspend @Tell !`, "valid"],
	] as const)("checks identities through nesting in %s", (body, expected) => {
		expect(verify(`foreign Ask: Effect Unit Num; foreign Tell: Effect Unit Num; let served = ${body};`)).toBe(expected);
	});

	it("checks a handler's suspension in its surrounding state", () => {
		expect(verify(String.raw`foreign Ask: Effect Unit Num; let served = with Ask: (\p k -> suspend @Ask !) in suspend @Ask !;`)).toBe("invalid");
	});

	it("preserves an outer handler while checking an inner handler", () => {
		expect(
			verify(String.raw`
foreign Ask: Effect Unit Num;
foreign Tell: Effect Unit Num;
let served = with Ask: (\p k -> k 7) in with Tell: (\p k -> suspend @Ask !) in suspend @Tell !;
`),
		).toBe("valid");
	});

	it("restores the surrounding state after a handled expression", () => {
		expect(
			verify(String.raw`
foreign Ask: Effect Unit Num;
let served = {
  with Ask: (\p k -> k 7) in suspend @Ask !;
  return suspend @Ask !;
};
`),
		).toBe("invalid");
	});

	it.each([String.raw`with Ask: (\p k -> k 7) in identity 3`, String.raw`with Ask: (\p k -> k 7) in with Tell: (\p k -> k 8) in identity 3`])(
		"passes the extended handler state to an ordinary pure call in %s",
		body => {
			expect(
				verify(String.raw`
foreign Ask: Effect Unit Num;
foreign Tell: Effect Unit Num;
let identity: Num -> Num = \value -> value;
let served = ${body};
`),
			).toBe("valid");
		},
	);

	// Retained-scope work owns the generated handler's colliding predicate and producer levels.
	it.fails.each([
		[7, "valid"],
		[0, "invalid"],
	] as const)("checks a source handler with a refined carrier payload %s", (value, expected) => {
		expect(
			verify(String.raw`
foreign Ask: Effect (Num [| \v -> v > 0 |]) Num;
let served = with Ask: (\p k -> k 7) in suspend @Ask ${value};
`),
		).toBe(expected);
	});

	it.each([
		[7, "valid"],
		[0, "invalid"],
	] as const)("checks the Core suspension payload refinement for %s", (value, expected) => {
		const C = EB.Constructors;
		const D = EB.DSL;
		const num = D.type("Num");
		const payload = C.Modal(num, { quantity: Q.Many, liquid: C.Lambda("v", "Explicit", D.gt(D.bound(0), D.num(0)), num) });
		const carrier = D.app(D.app(D.type("Effect"), payload), num);
		const base = mkCtx();
		const type = runNF(base, () => NF.evaluate(carrier));
		const ctx: EB.Context = { ...base, imports: { ...base.imports, Ask: [D.foreign("Ask"), type, []] } };
		const continuation = C.Pi("value", "Explicit", num, num);
		const handler = C.Lambda("p", "Explicit", C.Lambda("k", "Explicit", D.num(7), continuation), payload);
		const bubble = C.Bubble(0, num, [], D.foreign("Ask"), D.num(value));
		const core = C.Reset(bubble, { identity: D.foreign("Ask"), handler });
		const { answer } = VerificationServiceV2().synth(core, ctx, Metas.empty);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer[1].vc).tag).toBe(expected);
	});

	it.each([
		[true, "valid"],
		[false, "invalid"],
	] as const)("preserves a foreign value's declared refinement %s", (predicate, expected) => {
		expect(verify(String.raw`foreign given: Num [| \v -> ${predicate} |]; let served = given;`)).toBe(expected);
	});
});

const verify = (source: string) => {
	const declaration = elaborateModule(source).declarations.find(({ name }) => name === "served");
	assert(declaration);
	const { name, elaborated, error } = declaration;
	assert(elaborated, error);
	const { tm, ty, ctx, registry } = elaborated;
	const { answer } = VerificationServiceV2().letdec(name, tm, ty, ctx, registry);
	assert(!Eff.failed(answer));
	return Validity.check(answer.vc).tag;
};
