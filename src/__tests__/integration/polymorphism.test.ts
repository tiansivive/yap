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

describe("Language Tour — Polymorphism", () => {
	test("parametric polymorphism", () => {
		const result = runScript(`
let id: (a: Type) -> a -> a = \\a -> \\x -> x;
let const: (a: Type) -> (b: Type) -> a -> b -> a = \\a -> \\b -> \\x -> \\y -> x;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("implicit parameters", () => {
		const result = runScript(`
let id: (a: Type) => a -> a = \\x -> x;
let n2 = id 42;
let s2 = id "hello";
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("forcing implicits", () => {
		const result = runScript(`
let id: (a: Type) => a -> a = \\x -> x;
let forcedStr = id @String "hello";
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("inference and generalization", () => {
		const result = runScript(`
let inc = \\x -> x + 1;
let fst = \\x y -> x;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("let-polymorphism in blocks", () => {
		const result = runScript(`
let letpoly: Num = {
    let innerID = \\x -> x;
    let n: Num = innerID 42;
    let s: String = innerID "hi";
    return n;
};
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("implicit resolution with using", () => {
		const result = runScript(`
let addImplicit: (n: Num) => Num -> Num = \\x -> x + n;
using 10;
let eleven = addImplicit 1;
let fifteen = addImplicit 5;
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});

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
