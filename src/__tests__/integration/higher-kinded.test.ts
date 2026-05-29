import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

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
