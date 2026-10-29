import { describe, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Type Constructors", () => {
	test("maybe type", async () => {
		const result = runScript(`
let Maybe: Type -> Type = \\a -> | #nothing Unit | #just a;
let maybeNum: Maybe Num = #just 42;
let maybeStr: Maybe String = #nothing !;
		`);
		await snap(result);
	});

	test("recursive types — List", async () => {
		const result = runScript(`
let List: Type -> Type = \\a -> | #nil Unit | #cons { a, List a };
let empty: List Num = #nil !;
let listOf1: List Num = #cons { 1, #nil ! };
let listOf3: List Num = #cons { 1, #cons { 2, #cons { 3, #nil ! } } };
		`);
		await snap(result);
	});

	test("recursive types — Peano", async () => {
		const result = runScript(`
let Peano: Type = | #zero Unit | #succ Peano;
let zero: Peano = #zero !;
let first: Peano = #succ zero;
let second: Peano = #succ first;
		`);
		await snap(result);
	});
});
