import { describe, expect, test } from "vitest";

import { runSnippetsThroughRepl, type ReplSnippet } from "./helpers/repl";

const tutorialSnippets: ReplSnippet[] = [
	{
		id: "primitives",
		description: "Primitives & Literals",
		code: `
let n: Num = 42;
let s: String = "hello";
let b: Bool = true;
let u: Unit = !;
		`.trim(),
	},
	{
		id: "top-level",
		description: "Top-Level Declarations",
		code: `
let greeting: String = "Hello, Yap!";
let add: Num -> Num -> Num = \\x -> \\y -> x + y;
		`.trim(),
	},
	{
		id: "functions",
		description: "Functions & Applications",
		code: `
let identity: Num -> Num = \\x -> x;
let constNum: Num -> String -> Num = \\x -> \\y -> x;
let result1 = identity 42;
let result2 = add 10 20;
		`.trim(),
	},
	{
		id: "higher-order",
		description: "Higher-Order Functions",
		code: `
let compose: (Num -> Num) -> (Num -> Num) -> Num -> Num = \\f -> \\g -> \\x -> f (g x);
let addOne: Num -> Num = \\x -> x + 1;
let add5: Num -> Num = \\x -> x + 5;
let double = \\x -> x * 2;
let addOneThenDouble = compose double addOne;
addOneThenDouble 5;
		`.trim(),
	},
	{
		id: "records",
		description: "Records & Tuples",
		code: `
let point: { x: Num, y: Num } = { x: 10, y: 20 };
let person: { name: String, age: Num } = { name: "Alice", age: 30 };
let xCoord = point.x;
let getX: { x: Num, y: Num } -> Num = \\p -> p.x;
let rectangle: { width: Num, height: Num, area: Num } = { width: 10, height: 20, area: :width * :height };
let point3d = { point | y = 20, z = 30 };
let updated = { point | x = 100 };
let pair: { Num, String } = { 42, "answer" };
let pairExplicit: { 0: Num, 1: String } = { 0: 42, 1: "answer" };
let array: { [Num]: Num } = [1, 2, 3];
let dict: { [String]: Num } = { one: 1, two: 2, three: 3 };
		`.trim(),
	},
	{
		id: "variants",
		description: "Variants & Tagged Values",
		code: `
let TrafficLight: Type = | #red Unit | #yellow Unit | #green Unit;
let light: TrafficLight = #red !;
let Shape: Type = | #circle Num | #rectangle { Num, Num } | #point { x: Num, y: Num };
let c: Shape = #circle 5.0;
let r: Shape = #rectangle { 10, 20 };
let p: Shape = #point { x: 0, y: 0 };
		`.trim(),
	},
	{
		id: "pattern-matching",
		description: "Pattern Matching",
		code: `
let isZero: Num -> Bool = \\n -> match n
    | 0 -> true
    | _ -> false;

let getXMatch: { x: Num, y: Num } -> Num = \\p -> match p
    | { x: a, y: b } -> a;

let getX2: { x: Num, y: Num } -> Num = \\p -> match p
    | { x: a } -> a;

let describeShape: Shape -> String = \\s -> match s
    | #circle r -> "Circle with radius"
    | #rectangle { w, h } -> "Rectangle"
    | #point { x: _, y: _ } -> "Point at coordinates";

let firstOrZero: { [Num]: Num } -> Num = \\list -> match list
    | [] -> 0
    | [x | xs] -> x;

let tail: { [Num]: Num } -> { [Num]: Num } = \\list -> match list
    | [] -> [0]
    | [x | xs] -> xs;
		`.trim(),
	},
	{
		id: "blocks",
		description: "Statement Blocks",
		code: `
let compute: Num -> Num = \\x -> {
    let doubled = x * 2;
    let added = doubled + 10;
    return added;
};

let resultCompute = compute 5;

let processData: Num -> Num = \\n -> {
    let doubled = n * 2;
    let squared = doubled * doubled;
    let result = squared + 10;
    return result;
};

processData 5;
		`.trim(),
	},
	{
		id: "type-basics",
		description: "Defining Types",
		code: `
let MyNum: Type = Num;
let MyString: Type = String;
let nAlias: MyNum = 42;
let sAlias: MyString = "hi";

let Point: Type = { x: Num, y: Num };
let origin: Point = { x: 0, y: 0 };

let Maybe: Type -> Type = \\a -> | #nothing Unit | #just a;
let maybeNum: Maybe Num = #just 42;
let maybeStr: Maybe String = #nothing !;

let chooseType: Bool -> Type = \\b -> match b
    | true -> Num
    | false -> String;
let chosen: Type = chooseType true;
		`.trim(),
	},
	{
		id: "polymorphism",
		description: "Parametric Polymorphism",
		code: `
let idExplicit: (a: Type) -> a -> a = \\a -> \\x -> x;
let constExplicit: (a: Type) -> (b: Type) -> a -> b -> a = \\a -> \\b -> \\x -> \\y -> x;
let id: (a: Type) => a -> a = \\x -> x;
let idNum = id 42;
let idString = id "hello";
let forcedId = id @String "forced";

let blockPoly: Num = {
    let innerId = \\x -> x;
    let n: Num = innerId 42;
    let s: String = innerId "hi";
    return n;
};
		`.trim(),
	},
	{
		id: "implicits-traits",
		description: "Traits via Implicits",
		code: `
let Show: Type -> Type = \\t -> { show: t -> String };
let Eq: Type -> Type = \\t -> { eq: t -> t -> Bool };
let ShowNum: Show Num = { show: \\n -> stringify n };
let ShowBool: Show Bool = { show: \\b -> match b | true -> "true" | false -> "false" };
let EqNum: Eq Num = { eq: \\x y -> x == y };
let display: (show: Show t) => (x: t) -> String = \\x -> show.show x;
let areEqual: (eq: Eq t) => (x: t) -> (y: t) -> Bool = \\x y -> eq.eq x y;
using ShowNum;
using EqNum;
let shown = display 42;
let same = areEqual 10 10;
let diff = areEqual 5 10;
let displayIfEqual: (show: Show t) => (eq: Eq t) => (x: t) -> (y: t) -> String =
    \\x y -> match eq.eq x y
        | true -> "Equal: " ++ show.show x
        | false -> "Not equal";
let msg = displayIfEqual 5 5;
		`.trim(),
	},
	{
		id: "higher-kinded",
		description: "Higher-Kinded Polymorphism",
		code: `
let List: Type -> Type = \\a -> | #nil Unit | #cons { a, List a };
let Functor: (Type -> Type) -> Type = \\f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };
let mapList: (a: Type) => (b: Type) => (a -> b) -> List a -> List b =
    \\f -> \\list -> match list
        | #nil _ -> #nil !
        | #cons { x, xs } -> #cons { f x, mapList f xs };
let ListFunctor: Functor List = { map: mapList };
let polymorphicMap: (functor: Functor f) => (a: Type) => (b: Type) => (a -> b) -> f a -> f b =
    \\fn -> \\container -> functor.map fn container;
using ListFunctor;
let someList = #cons { 1, #cons { 2, #cons { 3, #nil ! } } };
let mappedList = polymorphicMap (\\x -> x + 1) someList;
		`.trim(),
	},
	{
		id: "row-polymorphism",
		description: "Row Polymorphism",
		code: `
let getXRow: (r: Row) => { x: Num | r } -> Num = \\record -> record.x;
let getName: (r: Row) => { name: String | r } -> String = \\obj -> obj.name;
let addZ: (r: Row) => { x: Num, y: Num | r } -> { x: Num, y: Num, z: Num | r } =
    \\rec -> { rec | z = 0 };
let name1 = getName { name: "Alice", age: 30 };
let name2 = getName { name: "1984", author: "Orwell", pages: 328 };
let xFromRecord = getXRow { x: 10, y: 20 };
let zRecord = addZ { x: 1, y: 2 };
let handleNone: (r: Row) => (| #none Unit | r) -> String = \\variant -> match variant
    | #none _ -> "Nothing here"
    | other -> "Something else";
let opt: | #none Unit | #some Num = #none !;
let handled = handleNone opt;
		`.trim(),
	},
	{
		id: "option-result",
		description: "Common Patterns",
		code: `
let Option: Type -> Type = \\a -> | #none Unit | #some a;
let safeDivide: Num -> Num -> Option Num = \\x -> \\y -> match y
    | 0 -> #none !
    | _ -> #some (x / y);
let resultOption = safeDivide 10 2;

let Result: Type -> Type -> Type = \\err -> \\ok -> | #error err | #ok ok;
let parse: String -> Result String Num = \\s -> match s
    | "42" -> #ok 42
    | _ -> #error "Not a valid number";
let parseGood = parse "42";
let parseBad = parse "hello";
		`.trim(),
	},
	{
		id: "dependent",
		description: "Dependent Types",
		code: `
let makeType: (b: Bool) -> Type = \\b -> match b
    | true -> Num
    | false -> String;
let Vec: Num -> Type -> Type = \\n -> \\t -> match n
    | 0 -> Unit
    | l -> { t, Vec (l - 1) t };
let vec0: Vec 0 Num = !;
let vec1: Vec 1 Num = { 10, vec0 };
let vec2: Vec 2 Num = { 20, vec1 };
let vec3: Vec 3 Num = { 30, vec2 };
let head: (n: Num) -> (a: Type) -> Vec (n + 1) a -> a = \\n -> \\a -> \\vec -> match vec
    | { x, xs } -> x;
let DependentPair: Type = { fst: Type, snd: :fst };
let numPair: DependentPair = { fst: Num, snd: 42 };
let strPair: DependentPair = { fst: String, snd: "hello" };
let Pair: (a: Type) -> (p: a -> Type) -> Type = \\a -> \\p -> { fst: a, snd: p :fst };
let examplePair: Pair Num (\\n -> String) = { fst: 42, snd: "hello" };
let example2: Pair Bool (\\b -> match b | true -> Num | false -> String) = { fst: true, snd: 100 };
let processDependent: (b: Bool) -> (v: match b | true -> Num | false -> String) -> String =
    \\b -> \\v -> match b
        | true -> stringify v
        | false -> v;
		`.trim(),
	},
	{
		id: "recursion",
		description: "Recursive Types",
		code: `
let emptyListNum: List Num = #nil !;
let oneItem: List Num = #cons { 1, emptyListNum };
let twoItems: List Num = #cons { 2, oneItem };
let Nat: Type = | #zero Unit | #succ Nat;
let zeroNat: Nat = #zero !;
let oneNat: Nat = #succ zeroNat;
let twoNat: Nat = #succ oneNat;
let lengthList: (a: Type) => List a -> Num = \\list -> match list
    | #nil _ -> 0
    | #cons { x, xs } -> 1 + (lengthList xs);
let Factorial: Type = { compute: Num -> Num };
let fact: Factorial = { compute: \\n -> match n
    | 0 -> 1
    | _ -> n * (:compute (n - 1)) };
fact.compute 5;
		`.trim(),
	},
	{
		id: "refinements",
		description: "Refinement Types",
		code: `
let NatRefined: Type = Num [|\\n -> n >= 0 |];
let Pos: Type = Num [|\\p -> p > 0 |];
let nNat: NatRefined = 42;
let pPos: Pos = 42;
let zeroNatRef: NatRefined = 0;
let exactOne: Num [|\\v -> v == 1 |] = 1;
let inc: (x: Num) -> Num [|\\v -> v == (x + 1) |] = \\x -> x + 1;
let useNat: NatRefined -> Num = \\n -> n;
let usePos: Pos -> Num = \\p -> p;
let hof: (f: NatRefined -> NatRefined) -> NatRefined = \\f -> f 1;
let hof2: (Num -> NatRefined) -> Pos = \\f -> (f 1) + 1;
let takePosFunction: (Pos -> Num) -> Num = \\f -> f 10;
let natToNum: NatRefined -> Num = \\x -> x;
let posToNum: Pos -> Num = \\x -> x;
let resultNatFn = takePosFunction natToNum;
let resultPosFn = takePosFunction posToNum;
let OrderedPair: Type = { fst: Num, snd: Num [|\\v -> v > :fst |] };
let validPair: OrderedPair = { fst: 3, snd: 5 };
		`.trim(),
	},
	{
		id: "ordered-lists",
		description: "Ordered Lists with Refinements",
		code: `
let OrderedList: Type -> Type = \\t -> | #nil Unit | #cons { head: t, tail: OrderedList (t[|\\v -> v > :head |]) };
let orderedList: OrderedList Num = #cons { head: 1, tail: #cons { head: 2, tail: #cons { head: 3, tail: #nil ! } } };
let OrderedListPoly: (t: Type) -> (p: t -> t -> Bool) -> Type =
		 -> \\p -> | #nil Unit
				| #cons { head: t, tail: OrderedListPoly (t[|\\v -> p :head v |]) p };
let ascending: OrderedListPoly Num (\\x y -> x < y) =
    #cons { head: 1, tail: #cons { head: 2, tail: #cons { head: 3, tail: #nil ! } } };
let descending: OrderedListPoly Num (\\x y -> x > y) =
    #cons { head: 3, tail: #cons { head: 2, tail: #cons { head: 1, tail: #nil ! } } };
		`.trim(),
	},
];

describe.sequential("examples README tutorial", () => {
	test("runs every snippet through the REPL", async () => {
		const { stderr, exitCode, results } = await runSnippetsThroughRepl(tutorialSnippets);
		expect(exitCode).toBe(0);
		expect(stderr).toBe("");

		const evaluated = results
			.filter(result => result.outputs.length > 0)
			.map(result => ({
				id: result.snippet.id,
				description: result.snippet.description,
				firstLine: result.snippet.code.split(/\\n/)[0],
				outputs: result.outputs,
			}));

		expect(evaluated).toMatchSnapshot();
	}, 180_000);
});
