import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Records & Tuples", () => {
	test("records", () => {
		const result = runScript(`
let point: { x: Num, y: Num } = { x: 0, y: 10 };
let person: { name: String, age: Num } = { name: "Alice", age: 30 };
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("self-referencing fields", () => {
		const result = runScript(`
let rectangle: { width: Num, height: Num, area: Num }
    = { width: 10, height: 20, area: :width * :height };
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("field access", () => {
		const result = runScript(`
let point = { x: 10, y: 20 };
let xCoord = point.x;
let getX: { x: Num, y: Num } -> Num = \\p -> p.x;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("field extension", () => {
		const result = runScript(`
let point = { x: 10 };
let point3d = { point | y = 20, z = 30 };
let updated = { point | x = 100 };
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("tuples", () => {
		const result = runScript(`
let pair: { Num, String } = { 42, "answer" };
let pairExplicit: { 0: Num, 1: String } = { 0: 42, 1: "answer" };
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("arrays and dictionaries", () => {
		const result = runScript(`
let array: { [Num]: Num } = [1, 2, 3];
let dict: { [String]: Num } = { one: 1, two: 2, three: 3 };
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
