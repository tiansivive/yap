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

	test("interfaces via records", () => {
		const result = runScript(`
foreign stringify: (a: Type) => a -> String;
let Show: Type -> Type = \\t -> { show: t -> String };
let Eq: Type -> Type = \\t -> { eq: t -> t -> Bool };
let ShowNum: Show Num = { show: \\n -> stringify n };
let ShowBool: Show Bool = { show: \\b -> match b | true -> "true" | false -> "false" };
let EqNum: Eq Num = { eq: \\x y -> x == y };
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("traits with implicits", () => {
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
		expect(snap(result)).toMatchSnapshot();
	});

	test("multiple constraints", () => {
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
		expect(snap(result)).toMatchSnapshot();
	});
});

describe("Language Tour — Higher-Kinded Polymorphism", () => {
	test("functor", () => {
		const result = runScript(`
let List: Type -> Type = \\a -> | #nil Unit | #cons { a, List a };
let Functor: (Type -> Type) -> Type = \\f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };
let mapList: (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \\f -> \\list -> match list
        | #nil _ -> #nil !
        | #cons { x, xs } -> #cons { f x, mapList f xs };
let ListFunctor: Functor List = { map: mapList };
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("fmap with implicit resolution", () => {
		const result = runScript(`
foreign stringify: (a: Type) => a -> String;
let List: Type -> Type = \\a -> | #nil Unit | #cons { a, List a };
let Functor: (Type -> Type) -> Type = \\f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };
let mapList: (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \\f -> \\list -> match list
        | #nil _ -> #nil !
        | #cons { x, xs } -> #cons { f x, mapList f xs };
let ListFunctor: Functor List = { map: mapList };
let fmap: (f: Type -> Type) => (functor: Functor f) => (a: Type) => (b: Type) => (a -> b) -> f a -> f b
    = \\fn -> \\container -> functor.map fn container;
using ListFunctor;
let strmap = fmap stringify;
let listOf1: List Num = #cons { 1, #nil ! };
let strList = strmap listOf1;
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
