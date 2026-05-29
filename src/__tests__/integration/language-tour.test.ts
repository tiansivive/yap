import { describe, expect, test } from "vitest";
import { runScript, type ScriptResult } from "./helpers/pipeline";

const snap = (result: ScriptResult) =>
	result.declarations.map(d => ({
		name: d.name,
		kind: d.kind,
		...(d.error ? { error: d.error } : {}),
		...(d.stages
			? {
					type: d.stages.type,
					elaborated: d.stages.elaborated,
					normalized: d.stages.normalized,
					gram: d.stages.gram,
					mir: d.stages.mir,
					codegenJS: d.stages.codegenJS,
				}
			: {}),
	}));

describe("Language Tour — Full Pipeline", () => {
	describe("Primitives & Literals", () => {
		test("primitive bindings", () => {
			const result = runScript(`
let greeting: String = "Hello, Yap!";
let life: Num = 42;
let b: Bool = true;
let u: Unit = !;
			`);
			expect(snap(result)).toMatchSnapshot();
		});
	});

	describe("Functions & Application", () => {
		test("lambda expressions", () => {
			const result = runScript(`
let identity: Num -> Num = \\x -> x;
let const: Num -> String -> Num = \\x y -> x;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("function application", () => {
			const result = runScript(`
let identity: Num -> Num = \\x -> x;
let add: Num -> Num -> Num = \\x y -> x + y;
let forty2 = identity 42;
let added = add 10 20;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("higher-order functions", () => {
			const result = runScript(`
let compose: (Num -> Num) -> (Num -> Num) -> Num -> Num = \\f g x -> f (g x);
let add1 = \\x -> x + 1;
let add5 = \\x -> x + 5;
let double = \\x -> x * 2;
let add1ThenDouble = compose double add1;
			`);
			expect(snap(result)).toMatchSnapshot();
		});
	});

	describe("Statement Blocks", () => {
		test("block with local bindings", () => {
			const result = runScript(`
let compute: Num -> Num = \\x -> {
    let doubled = x * 2;
    let added = doubled + 10;
    return added;
};
let result = compute 5;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("side effects in blocks", () => {
			const result = runScript(`
foreign print: String -> Unit;
foreign stringify: (a: Type) => a -> String;
let debug: Num -> Num = \\x -> {
    print "Computing...";
    let result = x * 2;
    print (stringify result);
    return result;
};
			`);
			expect(snap(result)).toMatchSnapshot();
		});
	});

	describe("Records & Tuples", () => {
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

	describe("Variants & Tagged Values", () => {
		test("simple variants", () => {
			const result = runScript(`
let TrafficLight: Type = | #red Unit | #yellow Unit | #green Unit;
let light: TrafficLight = #red !;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("variants with data", () => {
			const result = runScript(`
let Shape: Type
    = | #circle Num
      | #rectangle { Num, Num }
      | #point { x: Num, y: Num };
let c: Shape = #circle 5.0;
let r: Shape = #rectangle { 10, 20 };
let p: Shape = #point { x: 0, y: 0 };
			`);
			expect(snap(result)).toMatchSnapshot();
		});
	});

	describe("Pattern Matching", () => {
		test("literal patterns", () => {
			const result = runScript(`
let isZero: Num -> Bool = \\n -> match n
    | 0 -> true
    | _ -> false;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("record patterns", () => {
			const result = runScript(`
let getY: { x: Num, y: Num } -> Num = \\p -> match p
    | { x: a, y: b } -> b;
let getY2: { x: Num, y: Num } -> Num = \\p -> match p
    | { y: a } -> a;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("variant patterns", () => {
			const result = runScript(`
let Shape: Type
    = | #circle Num
      | #rectangle { Num, Num }
      | #point { x: Num, y: Num };
let describeShape: Shape -> String = \\s -> match s
    | #circle r -> "Circle with radius"
    | #rectangle { w, h } -> "Rectangle"
    | #point { x: _, y: _ } -> "Point at coordinates";
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("list patterns", () => {
			const result = runScript(`
let firstOrZero: { [Num]: Num } -> Num = \\list -> match list
    | [] -> 0
    | [x | xs] -> x;
let tail: { [Num]: Num } -> { [Num]: Num } = \\list -> match list
    | [] -> []
    | [x | xs] -> xs;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("recursive functions", () => {
			const result = runScript(`
let List: Type -> Type = \\a -> | #nil Unit | #cons { a, List a };
let length: (a: Type) => List a -> Num = \\list -> match list
    | #nil _ -> 0
    | #cons { x, xs } -> 1 + (length xs);
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("recursive record fields", () => {
			const result = runScript(`
let Factorial: Type = { compute: Num -> Num };
let fact: Factorial = { compute: \\n -> match n
    | 0 -> 1
    | _ -> n * (:compute (n - 1)) };
let result = fact.compute 5;
			`);
			expect(snap(result)).toMatchSnapshot();
		});
	});

	describe("Defining Types", () => {
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
let T: Type = chooseType true;
			`);
			expect(snap(result)).toMatchSnapshot();
		});
	});

	describe("Polymorphism", () => {
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

	describe("Row Polymorphism", () => {
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

	describe("Type Constructors", () => {
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

	describe("Higher-Kinded Polymorphism", () => {
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

	describe("Dependent Types", () => {
		test("dependent functions", () => {
			const result = runScript(`
let makeType: Bool -> Type = \\b -> match b
    | true -> Num
    | false -> String;
let T1: Type = makeType true;
let T2: Type = makeType false;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("length-indexed vectors", () => {
			const result = runScript(`
let Vec: Num -> Type -> Type = \\n t -> match n
    | 0 -> Unit
    | l -> { t, Vec (l - 1) t };
let vec0: Vec 0 Num = !;
let vec1: Vec 1 Num = { 10, vec0 };
let vec2: Vec 2 Num = { 20, vec1 };
let vec3: Vec 3 Num = { 30, vec2 };
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("dependent records (sigma types)", () => {
			const result = runScript(`
let DependentPair: Type = { fst: Type, snd: :fst };
let numPair: DependentPair = { fst: Num, snd: 42 };
let strPair: DependentPair = { fst: String, snd: "hello" };
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("generic dependent pairs", () => {
			const result = runScript(`
let Pair: (a: Type) -> (p: a -> Type) -> Type
    = \\a p -> { fst: a, snd: p :fst };
let exampleP1: Pair Num (\\n -> String) = { fst: 42, snd: "hello" };
let exampleP2: Pair Bool (\\b -> match b | true -> Num | false -> String)
    = { fst: true, snd: 100 };
			`);
			expect(snap(result)).toMatchSnapshot();
		});
	});

	describe("Refinement Types", () => {
		test("basic refinements", () => {
			const result = runScript(`
let Nat: Type = Num [| \\n -> n >= 0 |];
let Pos: Type = Num [| \\p -> p > 0 |];
let n: Nat = 42;
let p: Pos = 42;
let zero: Nat = 0;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("exact value refinements", () => {
			const result = runScript(`
let exactOne: Num [| \\v -> v == 1 |] = 1;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("pre and postconditions", () => {
			const result = runScript(`
let Nat: Type = Num [| \\n -> n >= 0 |];
let safe: (n: Nat) -> Nat = \\x -> x;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("input-output relationship", () => {
			const result = runScript(`
let inc: (x: Num) -> Num [| \\v -> v == (x + 1) |] = \\x -> x + 1;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("higher-order with refinements", () => {
			const result = runScript(`
let Nat: Type = Num [| \\n -> n >= 0 |];
let Pos: Type = Num [| \\p -> p > 0 |];
let hof: (f: Nat -> Nat) -> Nat = \\f -> f 1;
let hof2: (Num -> Nat) -> Pos = \\f -> (f 1) + 1;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("refinement subtyping", () => {
			const result = runScript(`
let Nat: Type = Num [| \\n -> n >= 0 |];
let Pos: Type = Num [| \\p -> p > 0 |];
let useNat: Nat -> Num = \\n -> n;
let p: Pos = 42;
let result = useNat p;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("contravariance", () => {
			const result = runScript(`
let Nat: Type = Num [| \\n -> n >= 0 |];
let Pos: Type = Num [| \\p -> p > 0 |];
let takePosFunction: (Pos -> Num) -> Num = \\f -> f 10;
let natToNum: Nat -> Num = \\x -> x;
let posToNum: Pos -> Num = \\x -> x;
let result1 = takePosFunction natToNum;
let result2 = takePosFunction posToNum;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("refinement polymorphism", () => {
			const result = runScript(`
let checkNum: (p: Num -> Bool) -> Num[| \\v -> p v |] -> Num = \\p x -> x;
let nat5 = checkNum (\\n -> n >= 0) 5;
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("ordered pair", () => {
			const result = runScript(`
let OrderedPair: Type = { fst: Num, snd: Num[| \\v -> v > :fst |] };
let valid: OrderedPair = { fst: 3, snd: 5 };
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("ordered lists with refinement polymorphism", () => {
			const result = runScript(`
let OrderedList: (t: Type) -> (p: t -> t -> Bool) -> Type = \\t -> \\p -> | #nil Unit | #cons { head: t, tail: OrderedList (t[| \\v -> p :head v |]) p };
let ascending: OrderedList Num (\\x -> \\y -> x < y) = #cons { head: 1, tail: #cons { head: 2, tail: #cons { head: 3, tail: #nil ! } } };
let descending: OrderedList Num (\\x -> \\y -> x > y) = #cons { head: 3, tail: #cons { head: 2, tail: #cons { head: 1, tail: #nil ! } } };
			`);
			expect(snap(result)).toMatchSnapshot();
		});
	});

	describe("Foreign Function Interface", () => {
		test("basic FFI", () => {
			const result = runScript(`
foreign print: String -> Unit;
foreign stringify: (a: Type) => a -> String;
let greet: String -> Unit = \\name -> {
    print ("Hello, " ++ name);
    return !;
};
			`);
			expect(snap(result)).toMatchSnapshot();
		});

		test("polymorphic FFI", () => {
			const result = runScript(`
foreign prepend: (a: Type) => a -> { [Num]: a } -> { [Num]: a };
foreign id: (a: Type) => a -> a;
let nums = prepend 42 [1, 2, 3];
let strs = prepend "a" ["b", "c"];
			`);
			expect(snap(result)).toMatchSnapshot();
		});
	});
});
