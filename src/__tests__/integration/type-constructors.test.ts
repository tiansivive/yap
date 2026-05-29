import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Type Constructors", () => {
	test("maybe type", () => {
		const result = runScript(`
let Maybe: Type -> Type = \\a -> | #nothing Unit | #just a;
let maybeNum: Maybe Num = #just 42;
let maybeStr: Maybe String = #nothing !;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("recursive types — List", () => {
		const result = runScript(`
let List: Type -> Type = \\a -> | #nil Unit | #cons { a, List a };
let empty: List Num = #nil !;
let listOf1: List Num = #cons { 1, #nil ! };
let listOf3: List Num = #cons { 1, #cons { 2, #cons { 3, #nil ! } } };
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("recursive types — Peano", () => {
		const result = runScript(`
let Peano: Type = | #zero Unit | #succ Peano;
let zero: Peano = #zero !;
let first: Peano = #succ zero;
let second: Peano = #succ first;
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
