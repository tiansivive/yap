import assert from "node:assert";
import { describe, expect, it } from "vitest";
import { match } from "ts-pattern";

import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { VerificationServiceV2 } from "../V2/service";
import { Validity } from "../validity";

describe("Verification scope", () => {
	it.each([
		[1, "valid"],
		[0, "invalid"],
	] as const)("checks numeric branch guards with fallback %s", (fallback, expected) => {
		const vc = checked(String.raw`let f: Num -> Num [| \r -> r > 0 |] = \x -> match (x > 0) | true -> x | false -> ${fallback};`);

		expect(Validity.check(vc).tag).toBe(expected);
	});

	it.each([
		["x == x", "valid"],
		["{ let flag = x == x; return flag; }", "valid"],
		["x == 0", "invalid"],
	] as const)("verifies the Boolean result contract for %s", (body, expected) => {
		const vc = checked(String.raw`let f: Num -> Bool [| \r -> r |] = \x -> ${body};`);

		expect(Validity.check(vc).tag).toBe(expected);
	});

	it("retains the parameter in a local binding's refinement", () => {
		const vc = checked(String.raw`let compute: (input: Num) -> Num [| \r -> r == (input * 2) |] = \input -> {
			let doubled = input * 2;
			return doubled;
		};`);

		expect(Validity.check(vc).tag).toBe("valid");
	});

	it.each(["x", "n"])("preserves equality contracts with parameter %s", parameter => {
		const valid = checked(`let next: (${parameter}: Num) -> Num [| \\r -> r == (${parameter} + 1) |] = \\${parameter} -> ${parameter} + 1;`);
		const invalid = checked(`let next: (${parameter}: Num) -> Num [| \\r -> r == (${parameter} + 1) |] = \\${parameter} -> ${parameter};`);

		expect(Validity.check(valid).tag).toBe("valid");
		expect(Validity.check(invalid).tag).toBe("invalid");
	});

	it("keeps a result contract tied to the parameter when a local binding shadows it", () => {
		const vc = checked(String.raw`let f: (x: Num) -> Num [| \r -> r == x |] = \x -> { let x = 0; return x; };`);

		expect(Validity.check(vc).tag).toBe("invalid");
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

	it.each([
		["1", "valid"],
		["0", "invalid"],
	] as const)("retains the value of a literal local initialized with %s", (value, expected) => {
		const vc = checked(String.raw`let f: Num -> Num [| \r -> r > 0 |] = \x -> { let a = ${value}; return a; };`);

		expect(Validity.check(vc).tag).toBe(expected);
	});

	it.each([
		["input", "valid"],
		["0", "invalid"],
	] as const)("retains the equality of a local alias initialized with %s", (value, expected) => {
		const vc = checked(String.raw`let copy: (input: Num) -> Num [| \r -> r == input |] = \input -> { let alias = ${value}; return alias; };`);

		expect(Validity.check(vc).tag).toBe(expected);
	});

	it.each([
		["x + 1", "valid"],
		["x - 1", "invalid"],
	] as const)("opens a refined parameter while checking %s", (body, expected) => {
		const vc = checked(String.raw`let f: Num [| \n -> n > 0 |] -> Num [| \r -> r > 1 |] = \x -> ${body};`);

		expect(Validity.check(vc).tag).toBe(expected);
	});

	it.each([
		["Num [| \\n -> n > 0 |]", "valid"],
		["Num", "invalid"],
	] as const)("checks an explicitly refined local initialized from %s", (input, expected) => {
		const vc = checked(String.raw`let f: ${input} -> Num [| \r -> r > 0 |] = \x -> { let a: Num [| \v -> v > 0 |] = x; return a; };`);

		expect(Validity.check(vc).tag).toBe(expected);
	});

	it("checks an impossible initializer independently of the continuation's assumptions", () => {
		const vc = checked(String.raw`let f: Num -> Num = \x -> { let a: Num [| \n -> false |] = 0; return 1; };`);

		expect(Validity.check(vc).tag).toBe("invalid");
	});

	it("preserves facts through two inferred arithmetic locals", () => {
		const vc = checked(String.raw`let f: (x: Num) -> Num [| \r -> r == ((x * 2) + 10) |] = \x -> {
			let doubled = x * 2;
			let added = doubled + 10;
			return added;
		};`);

		expect(Validity.check(vc).tag).toBe("valid");
	});

	it.each([
		["x + 1", "valid"],
		["x + 2", "invalid"],
	] as const)("retains %s through a nested block and shadowing", (value, expected) => {
		const vc = checked(String.raw`let f: (x: Num) -> Num [| \r -> r == (x + 1) |] = \x -> {
			let a = { let b = ${value}; return b; };
			let x = 0;
			return a;
		};`);

		expect(Validity.check(vc).tag).toBe(expected);
	});

	it.each([
		["y", "valid"],
		["x", "invalid"],
	] as const)("preserves a later parameter through local shadowing when retaining %s", (value, expected) => {
		const vc = checked(String.raw`let f: (x: Num) -> (y: Num) -> Num [| \r -> r == y |] = \x -> \y -> {
			let a = x + 1;
			let saved = ${value};
			let y = 0;
			return saved;
		};`);

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
