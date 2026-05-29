import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Defining Types", () => {
	test("first-class types", () => {
		const result = runScript(`
let MyNum: Type = Num;
let MyString: Type = String;
let n: MyNum = 42;
let s: MyString = "hi";
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("type aliases", () => {
		const result = runScript(`
let Point: Type = { x: Num, y: Num };
let origin: Point = { x: 0, y: 0 };
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("computing types", () => {
		const result = runScript(`
let chooseType: Bool -> Type = \\b -> match b
    | true -> Num
    | false -> String;
let T1: Type = chooseType true;
let T2: Type = chooseType false;
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
