import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Higher-Kinded Polymorphism", () => {
	test("functor", async () => {
		const result = runScript(`
let List: Type -> Type = \\a -> | #nil Unit | #cons { a, List a };
let Functor: (Type -> Type) -> Type = \\f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };
let mapList: (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \\f -> \\list -> match list
        | #nil _ -> #nil !
        | #cons { x, xs } -> #cons { f x, mapList f xs };
let ListFunctor: Functor List = { map: mapList };
		`);
		await snap(result);
	});

	test("fmap with implicit resolution", async () => {
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
		await snap(result);
	});

	/* `Option` is not recursive, so nothing but the reference keeps `Option Num` from unfolding to its variant row before unification meets it. */
	test("fmap over a non-recursive alias resolves the alias's instance", async () => {
		const result = runScript(`
foreign stringify: (a: Type) => a -> String;
let Functor: (Type -> Type) -> Type = \\f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };
let fmap: (f: Type -> Type) => (functor: Functor f) => (a: Type) => (b: Type) => (a -> b) -> f a -> f b
    = \\fn -> \\container -> functor.map fn container;
let Option: Type -> Type = \\a -> | #some a | #none Unit;
let mapOption: (a: Type) => (b: Type) => (a -> b) -> Option a -> Option b
    = \\f -> \\o -> match o | #some x -> #some (f x) | #none _ -> #none !;
let OptionFunctor: Functor Option = { map: mapOption };
using OptionFunctor;
let x: Option Num = #some 1;
let y = fmap stringify x;
		`);
		await snap(result);
		const y = result.declarations.find(d => d.name === "y");
		expect(y?.errors).toEqual({});
		expect(y?.stages?.type).toBe("Option String");
		expect(y?.stages?.elaborated).toContain("fmap @Option @OptionFunctor @Num @String");
	});
});
