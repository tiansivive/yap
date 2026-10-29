import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Typeclasses", () => {
	test("interfaces via records", async () => {
		const result = runScript(`
foreign stringify: (a: Type) => a -> String;
let Show: Type -> Type = \\t -> { show: t -> String };
let Eq: Type -> Type = \\t -> { eq: t -> t -> Bool };
let ShowNum: Show Num = { show: \\n -> stringify n };
let ShowBool: Show Bool = { show: \\b -> match b | true -> "true" | false -> "false" };
let EqNum: Eq Num = { eq: \\x y -> x == y };
		`);
		await snap(result);
	});

	test("traits with implicits", async () => {
		const result = runScript(`
foreign stringify: (a: Type) => a -> String;
let Show: Type -> Type = \\t -> { show: t -> String };
let Eq: Type -> Type = \\t -> { eq: t -> t -> Bool };
let ShowNum: Show Num = { show: \\n -> stringify n };
let EqNum: Eq Num = { eq: \\x y -> x == y };
let display: (t: Type) => (show: Show t) => (x: t) -> String = \\x -> show.show x;
let areEqual: (t: Type) => (eq: Eq t) => (x: t) -> (y: t) -> Bool = \\x y -> eq.eq x y;
using ShowNum;
using EqNum;
let shown = display 42;
let same = areEqual 10 10;
		`);
		await snap(result);
	});

	test("using inside block expression", async () => {
		const result = runScript(`
foreign stringify: (a: Type) => a -> String;
let Show: Type -> Type = \\t -> { show: t -> String };
let Eq: Type -> Type = \\t -> { eq: t -> t -> Bool };
let ShowNum: Show Num = { show: \\n -> stringify n };
let EqNum: Eq Num = { eq: \\x y -> x == y };
let areEqual: (t: Type) => (eq: Eq t) => (x: t) -> (y: t) -> Bool = \\x y -> eq.eq x y;
let result = {
  using EqNum;
  let same = areEqual 10 10;
  return same;
};
		`);
		await snap(result);
	});

	test("multiple constraints", async () => {
		const result = runScript(`
foreign stringify: (a: Type) => a -> String;
let Show: Type -> Type = \\t -> { show: t -> String };
let Eq: Type -> Type = \\t -> { eq: t -> t -> Bool };
let ShowNum: Show Num = { show: \\n -> stringify n };
let EqNum: Eq Num = { eq: \\x y -> x == y };
let displayIfEqual: (t: Type) => (show: Show t) => (eq: Eq t) => (x: t) -> (y: t) -> String
    = \\x -> \\y -> match (eq.eq x y)
        | true -> "Equal: " ++ (show.show x)
        | false -> "Not equal";
using ShowNum;
using EqNum;
let msg = displayIfEqual 5 5;
		`);
		await snap(result);
		expect(result.declarations.find(d => d.name === "msg")?.errors).toEqual({});
	});
});
