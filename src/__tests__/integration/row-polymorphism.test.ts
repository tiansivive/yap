import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Row Polymorphism", () => {
	test("open records", () => {
		const result = runScript(`
let getX: (r: Row) => { x: Num | r } -> Num = \\record -> record.x;
let p1 = getX { x: 10, y: 20 };
let p2 = getX { x: 5, y: 3, z: 7 };
let p3 = getX { x: 100, name: "point" };
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("polymorphic projection", () => {
		const result = runScript(`
let getName: (r: Row) => { name: String | r } -> String = \\obj -> obj.name;
let person = { name: "Alice", age: 30 };
let book = { name: "1984", author: "Orwell", pages: 328 };
let n1 = getName person;
let n2 = getName book;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("polymorphic extension", () => {
		const result = runScript(`
let addZ: (r: Row) => { x: Num, y: Num | r } -> { x: Num, y: Num, z: Num | r }
    = \\rec -> { rec | z = 0 };
let p1 = addZ { x: 1, y: 2 };
let p2 = addZ { x: 5, y: 10, color: "red" };
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
