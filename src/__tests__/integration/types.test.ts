import { describe, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Defining Types", () => {
	test("first-class types", async () => {
		const result = runScript(`
let MyNum: Type = Num;
let MyString: Type = String;
let n: MyNum = 42;
let s: MyString = "hi";
		`);
		await snap(result);
	});

	test("type aliases", async () => {
		const result = runScript(`
let Point: Type = { x: Num, y: Num };
let origin: Point = { x: 0, y: 0 };
		`);
		await snap(result);
	});

	test("computing types", async () => {
		const result = runScript(`
let chooseType: Bool -> Type = \\b -> match b
    | true -> Num
    | false -> String;
let T1: Type = chooseType true;
let T2: Type = chooseType false;
		`);
		await snap(result);
	});
});
