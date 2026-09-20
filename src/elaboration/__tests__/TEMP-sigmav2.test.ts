import { describe, it, expect } from "vitest";

import * as Eff from "@yap/utils/effects";
import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Errors from "@yap/elaboration/shared/errors";
import * as NF from "@yap/elaboration/normalization";

import { mkCtx, parseExpr, runEB, shown } from "../inference/__tests__/util";
import { runScript } from "../../__tests__/integration/helpers/pipeline";

/*
 * Working suite for the sigma/nu phase. Every case asserts, so a break shows up per-test in the
 * IDE rather than in a console dump. Cases copied from the shipping suites live at the bottom;
 * when they all pass, the shipping suites can be updated and this file deleted.
 */

/** Elaborate an expression, solve, normalize, read back. Throws on any failure. */
const run = (src: string): string => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();

	const ctx = mkCtx();
	const term = parseExpr(src);

	const { answer, registry } = runEB(ctx, function* () {
		const [tm, ty] = yield* EB.infer(term);
		const { constraints } = yield* M.writer.peek();
		yield* EB.solve(constraints);

		/* Small budget: an unguarded label cycle runs until the fuel cap, and the default is 10M. */
		const value = yield* NF.normalize(tm, { maxSteps: 20_000 });
		/* Readback is part of the round trip: a depth error shows up here and nowhere earlier. */
		return { tm, ty, value, quoted: yield* NF.quote(ctx.env.length, value) };
	});

	const disp = shown(ctx, registry);
	if (Eff.failed(answer)) {
		throw new Error(disp(() => Errors.report(answer[Eff.ABORT])));
	}

	/* One ordered block rather than an object: a snapshotted object serializes its keys
	 * alphabetically, which would scramble the pipeline order. */
	const stages: [string, string][] = [
		["source", src.trim()],
		["elaborated", disp(() => EB.Display.Term(answer.tm))],
		["type", disp(() => NF.display(answer.ty))],
		["normal", disp(() => NF.display(answer.value))],
		["readback", disp(() => EB.Display.Term(answer.quoted))],
	];

	return stages.map(([label, text]) => `${label.padEnd(10)} ${text.split("\n").join("\n" + " ".repeat(11))}`).join("\n");
};

/** Must elaborate; the source and its normal form are snapshotted together, so a diff shows what
 * was written next to what it now means. */
const works = (name: string, src: string) => {
	// eslint-disable-next-line vitest/valid-title -- titles are passed in by the caller
	it(name, () => {
		expect(run(src)).toMatchSnapshot();
	});
};

/** Must fail, with this message. Covers deferred paths and deliberate rejections alike. */
const rejects = (name: string, src: string, message: string) => {
	// eslint-disable-next-line vitest/valid-title -- titles are passed in by the caller
	it(name, () => {
		expect(() => run(src)).toThrow(message);
	});
};

/* Consumers this phase does not own. A copied script is green once elaboration is clean, without
 * waiting on GRAM lowering or on verification learning the new binders. Matched by removal rather
 * than by splitting: the messages carry environments like `Γ: $sig; t; Show`, so a split on `;`
 * shreds them into fragments and each fragment then reads as an unrecognised error. */
const DOWNSTREAM = [
	/(SigmaV2|Nu) not yet lowered[^;]*/g,
	/synth: case not implemented for term [\s\S]*?(?=; (?:synth|Subtype|Projection|\w+ not yet)|$)/g,
	/Subtype not implemented for [\s\S]*?(?=; (?:synth|Subtype|Projection|\w+ not yet)|$)/g,
	/Projection expected a Sigma type[^;]*/g,
];

const elaborationErrors = (source: string): string[] =>
	runScript(source)
		.declarations.map(d => DOWNSTREAM.reduce((acc, r) => acc.replace(r, ""), d.error ?? ""))
		.map(e => e.replace(/[;\s]+/g, " ").trim())
		.filter(e => e.length > 0);

/** A script copied from a shipping suite: must reach the end of elaboration cleanly. */
const script = (name: string, source: string) => {
	// eslint-disable-next-line vitest/valid-title -- titles are passed in by the caller
	it(name, () => {
		expect(elaborationErrors(source)).toEqual([]);
	});
};

describe("sigma and nu", () => {
	describe("01 struct types", () => {
		works("001 plain struct type", `{ a: Num, b: String }`);
		works("002 empty struct type", `{}`);
		works("003 nested struct type", `{ a: Num, b: { c: String } }`);
	});

	describe("02 struct values", () => {
		works("004 plain struct value", `{ a: 1, b: "x" }`);
		works("005 projection off a literal", `{ a: 1, b: "x" }.a`);
	});

	describe("03 dep-label refs, inference path", () => {
		rejects("006 &foo in a field type", `{ n: Num, m: &n }`, "No enclosing record field named n");
		rejects("007 &foo self reference", `{ foo: &foo }`, "No enclosing record field named foo");
		rejects("008 &foo unknown label", `{ n: Num, m: &nope }`, "No enclosing record field named nope");
	});

	describe("04 nu-label refs, inference path", () => {
		works("009 $foo in a field value", `{ a: 1, b: $a }`);
		it("010 $foo self cycle is inert until projected", () => {
			/*
			 * A self-reference inside Nu is inert until an observation demands it. This raw expression
			 * has no generalization boundary, so the field type remains an unconstrained meta; the point
			 * is that the Nu value itself reaches WHNF. Projection observes the cyclic field and is
			 * bounded by evaluator fuel.
			 */
			expect(run(`{ a: $a }`)).toMatchSnapshot();
			expect(() => run(`{ a: $a }.a`)).toThrow("exceeded maximum steps");
		});
	});

	describe("05 nu elimination by projection", () => {
		works("011 project a plain field", `{ let P: Type = { a: Num }; let p: P = { a: 1 }; return p.a; }`);
		works("012 project the other field", `{ let P: Type = { a: Num, b: String }; let p: P = { a: 1, b: "x" }; return p.b; }`);
		works("013 project a dependent field", `{ let P: Type = { n: Num, m: &n }; let p: P = { n: 1, m: 1 }; return p.m; }`);
		works("014 project through a nested nu", `{ let Q: Type = { c: Num }; let P: Type = { q: Q }; let p: P = { q: { c: 2 } }; return p.q.c; }`);
		works("015 arithmetic on a projected field", `{ let P: Type = { a: Num }; let p: P = { a: 1 }; return p.a + 1; }`);
	});

	describe("06 label resolution and scoping", () => {
		rejects("016 unknown label errors", `{ let P: Type = { n: Num, m: &nope }; return P; }`, "No enclosing record field named nope");
		works("017 known label resolves", `{ let P: Type = { n: Num, m: &n }; return P; }`);
		works("018 inner scope reaches outward", `{ let P: Type = { a: Num, b: { c: &a } }; return P; }`);
		works("019 inner shadows on its own label", `{ let P: Type = { a: Num, b: { a: String, c: &a } }; return P; }`);
		rejects("020 unknown in nested inner", `{ let P: Type = { a: Num, b: { c: &nope } }; return P; }`, "No enclosing record field named nope");
	});

	describe("07 nested struct types", () => {
		works("021 type only", `{ let Q: Type = { c: Num }; let P: Type = { q: Q }; return P; }`);
		works("022 inline nested type", `{ let P: Type = { q: { c: Num } }; return P; }`);
		works("023 value, no projection", `{ let Q: Type = { c: Num }; let P: Type = { q: Q }; let p: P = { q: { c: 2 } }; return p; }`);
		works("024 value against inline nested", `{ let P: Type = { q: { c: Num } }; let p: P = { q: { c: 2 } }; return p; }`);
		works("025 outer projection only", `{ let Q: Type = { c: Num }; let P: Type = { q: Q }; let p: P = { q: { c: 2 } }; return p.q; }`);
	});

	describe("08 schema meets sigma", () => {
		works("026 inferred arg into annotated domain", `{ let f = \\(x: { a: Num }) -> x.a; return f { a: 1 }; }`);
		works("027 annotated arg into inferred domain", `{ let P: Type = { a: Num }; let p: P = { a: 1 }; let f = \\x -> x.a; return f p; }`);
		works("028 annotated value into annotated domain", `{ let P: Type = { a: Num }; let p: P = { a: 1 }; let f = \\(x: { a: Num }) -> x.a; return f p; }`);
		works("029 inferred value against annotated type", `{ let P: Type = { a: Num }; let v = { a: 1 }; let p: P = v; return p; }`);
	});

	describe("09 nu-label, checked path", () => {
		works("030 sibling reference", `{ let P: Type = { a: Num, b: Num }; let p: P = { a: 1, b: $a }; return p; }`);
		works("031 sibling then project", `{ let P: Type = { a: Num, b: Num }; let p: P = { a: 1, b: $a }; return p.b; }`);
		works("032 arithmetic on a sibling", `{ let P: Type = { a: Num, b: Num }; let p: P = { a: 1, b: $a + 1 }; return p.b; }`);
		works("033 self cycle", `{ let P: Type = { a: Num }; let p: P = { a: $a }; return p; }`);
		rejects("034 self cycle, projected", `{ let P: Type = { a: Num }; let p: P = { a: $a }; return p.a; }`, "exceeded maximum steps");
		rejects("035 mutual cycle, projected", `{ let P: Type = { a: Num, b: Num }; let p: P = { a: $b, b: $a }; return p.a; }`, "exceeded maximum steps");
		rejects("036 unknown label", `{ let P: Type = { a: Num, b: Num }; let p: P = { a: 1, b: $nope }; return p; }`, "No enclosing record field named nope");
		works("037 forward reference", `{ let P: Type = { a: Num, b: Num }; let p: P = { a: $b, b: 2 }; return p.a; }`);
	});

	describe("10 dep-label by use position", () => {
		works("038 type position", `{ let P: Type = { fst: Num, snd: &fst }; return P; }`);
		works("039 refinement position", `{ let P: Type = { fst: Num, snd: Num[| \\v -> v > &fst |] }; return P; }`);
	});

	describe("11 row extension", () => {
		works("041 extension function", `{ let addZ: (r: Row) => { x: Num | r } -> { x: Num, z: Num | r } = \\rec -> { rec | z = 0 }; return addZ; }`);
		works(
			"042 extension applied",
			`{ let addZ: (r: Row) => { x: Num | r } -> { x: Num, z: Num | r } = \\rec -> { rec | z = 0 }; let p = addZ { x: 1 }; return p; }`,
		);
		works("043 open row annotation keeps its tail", `{ let f: (r: Row) => { x: Num | r } -> Num = \\rec -> rec.x; return f; }`);
	});

	describe("12 dependent rejection", () => {
		rejects("044 amp mismatch must fail", `{ let P: Type = { fst: Num, snd: &fst }; let p: P = { fst: 1, snd: 5 }; return p; }`, "Cannot unify");
		works("045 amp match must pass", `{ let P: Type = { fst: Num, snd: &fst }; let p: P = { fst: 1, snd: 1 }; return p; }`);
	});

	describe("13 annotated bindings", () => {
		works("047 value against struct type", `{ let P: Type = { a: Num }; let p: P = { a: 1 }; return p; }`);
		works("048 projection off annotated", `{ let P: Type = { a: Num }; let p: P = { a: 1 }; return p.a; }`);
		works("049 dependent singleton", `{ let P: Type = { n: Num, m: &n }; let p: P = { n: 1, m: 1 }; return p; }`);
	});

	describe("14 copied from the shipping suites", () => {
		script(
			"052 higher-kinded.test: functor",
			`
let List: Type -> Type = \\a -> | #nil Unit | #cons { a, List a };
let Functor: (Type -> Type) -> Type = \\f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };
let mapList: (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \\f -> \\list -> match list
        | #nil _ -> #nil !
        | #cons { x, xs } -> #cons { f x, mapList f xs };
let ListFunctor: Functor List = { map: mapList };
		
		`,
		);
		script(
			"053 higher-kinded.test: fmap with implicit resolution",
			`
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
		
		`,
		);
		script(
			"054 records.test: records",
			`
let point: { x: Num, y: Num } = { x: 0, y: 10 };
let person: { name: String, age: Num } = { name: "Alice", age: 30 };
		
		`,
		);
		script(
			"056 records.test: field access",
			`
let point = { x: 10, y: 20 };
let xCoord = point.x;
let getX: { x: Num, y: Num } -> Num = \\p -> p.x;
		
		`,
		);
		script(
			"057 records.test: tuples",
			`
let pair: { Num, String } = { 42, "answer" };
let pairExplicit: { 0: Num, 1: String } = { 0: 42, 1: "answer" };
		
		`,
		);
		script(
			"058 row-polymorphism.test: open records",
			`
let getX: (r: Row) => { x: Num | r } -> Num = \\record -> record.x;
let p1 = getX { x: 10, y: 20 };
let p2 = getX { x: 5, y: 3, z: 7 };
let p3 = getX { x: 100, name: "point" };
		
		`,
		);
		script(
			"059 row-polymorphism.test: polymorphic projection",
			`
let getName: (r: Row) => { name: String | r } -> String = \\obj -> obj.name;
let person = { name: "Alice", age: 30 };
let book = { name: "1984", author: "Orwell", pages: 328 };
let n1 = getName person;
let n2 = getName book;
		
		`,
		);
		script(
			"060 row-polymorphism.test: polymorphic extension",
			`
let addZ: (r: Row) => { x: Num, y: Num | r } -> { x: Num, y: Num, z: Num | r }
    = \\rec -> { rec | z = 0 };
let p1 = addZ { x: 1, y: 2 };
let p2 = addZ { x: 5, y: 10, color: "red" };
		
		`,
		);
		script(
			"061 typeclasses.test: interfaces via records",
			`
foreign stringify: (a: Type) => a -> String;
let Show: Type -> Type = \\t -> { show: t -> String };
let Eq: Type -> Type = \\t -> { eq: t -> t -> Bool };
let ShowNum: Show Num = { show: \\n -> stringify n };
let ShowBool: Show Bool = { show: \\b -> match b | true -> "true" | false -> "false" };
let EqNum: Eq Num = { eq: \\x y -> x == y };
		
		`,
		);
		script(
			"062 typeclasses.test: traits with implicits",
			`
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
		
		`,
		);
		script(
			"063 typeclasses.test: using inside block expression",
			`
foreign stringify: (a: Type) => a -> String;
let Show: Type -> Type = \\t -> { show: t -> String };
let Eq: Type -> Type = \\t -> { eq: t -> t -> Bool };
let ShowNum: Show Num = { show: \\n -> stringify n };
let EqNum: Eq Num = { eq: \\x y -> x == y };
let areEqual: (t: Type) => (eq: Eq t) => (x: t) -> (y: t) -> Bool = \\x y -> eq.eq x y;
let result = {
  using EqNum;
  let same = areEqual 10 10;
  return same;
};
		
		`,
		);
		script(
			"064 typeclasses.test: multiple constraints",
			`
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
		
		`,
		);
		script(
			"065 variants.test: variants with data",
			`
let Shape: Type
    = | #circle Num
      | #rectangle { Num, Num }
      | #point { x: Num, y: Num };
let c: Shape = #circle 5.0;
let r: Shape = #rectangle { 10, 20 };
let p: Shape = #point { x: 0, y: 0 };
		
		`,
		);
		script(
			"066 variants.test: record patterns",
			`
let getY: { x: Num, y: Num } -> Num = \\p -> match p
    | { x: a, y: b } -> b;
let getY2: { x: Num, y: Num } -> Num = \\p -> match p
    | { y: a } -> a;
		
		`,
		);
		script(
			"067 variants.test: variant patterns",
			`
let Shape: Type
    = | #circle Num
      | #rectangle { Num, Num }
      | #point { x: Num, y: Num };
let describeShape: Shape -> String = \\s -> match s
    | #circle r -> "Circle with radius"
    | #rectangle { w, h } -> "Rectangle"
    | #point { x: _, y: _ } -> "Point at coordinates";
		
		`,
		);
		script(
			"069 variants.test: recursive list type",
			`
let List: (t: Type) -> Type = \\t -> | #nil Unit | #cons { head: t, tail: List t };
let xs: List Num = #cons { head: 1, tail: #cons { head: 2, tail: #nil ! } };
		
		`,
		);
		script(
			"070 types.test: type aliases",
			`
let Point: Type = { x: Num, y: Num };
let origin: Point = { x: 0, y: 0 };
		
		`,
		);
	});

	/* V2 replacements for copied legacy-label cases. */
	describe("16 v2 duals of the copied scripts", () => {
		script(
			"086 dependent records, amp",
			`
let DependentPair: Type = { fst: Type, snd: &fst };
let numPair: DependentPair = { fst: Num, snd: 42 };
let strPair: DependentPair = { fst: String, snd: "hello" };
		`,
		);
		script(
			"087 generic dependent pairs, amp",
			`
let Pair: (a: Type) -> (p: a -> Type) -> Type
    = \\a p -> { fst: a, snd: p &fst };
let exampleP1: Pair Num (\\n -> String) = { fst: 42, snd: "hello" };
let exampleP2: Pair Bool (\\b -> match b | true -> Num | false -> String)
    = { fst: true, snd: 100 };
		`,
		);
		script(
			"088 self-referencing fields, nu",
			`
let rectangle: { width: Num, height: Num, area: Num }
    = { width: 10, height: 20, area: $width * $height };
		`,
		);
		script(
			"089 recursive record fields, nu",
			`
let Factorial: Type = { compute: Num -> Num };
let fact: Factorial = { compute: \\n -> match n
    | 0 -> 1
    | _ -> n * ($compute (n - 1)) };
let result = fact.compute 5;
		`,
		);
		script(
			"090 ordered pair, amp",
			`
let OrderedPair: Type = { fst: Num, snd: Num[| \\v -> v > &fst |] };
let valid: OrderedPair = { fst: 3, snd: 5 };
		`,
		);
		script(
			"091 dependent record construction, amp",
			`
let test = {
    let Pair
    : (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
    = \\a -> \\b -> \\p -> { fst: a, snd: b[| \\v -> p &fst v |] };
    let p
    : Pair Num Num (\\x -> \\y -> x < y )
    = { fst: 1, snd: 2 };
};
		`,
		);
		script(
			"092 dependent record construction rejects invalid field, amp",
			`
let testFail = {
    let Pair
    : (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
    = \\a -> \\b -> \\p -> { fst: a, snd: b[| \\v -> p &fst v |] };
    let p
    : Pair Num Num (\\x -> \\y -> x < y )
    = { fst: 2, snd: 1 };
    return 1;
};
		`,
		);
		script(
			"093 ordered lists with refinement polymorphism, amp",
			`
let OrderedList: (t: Type) -> (p: t -> t -> Bool) -> Type = \\t -> \\p -> | #nil Unit | #cons { head: t, tail: OrderedList (t[| \\v -> p &head v |]) p };
let ascending: OrderedList Num (\\x -> \\y -> x < y) = #cons { head: 1, tail: #cons { head: 2, tail: #cons { head: 3, tail: #nil ! } } };
let descending: OrderedList Num (\\x -> \\y -> x > y) = #cons { head: 3, tail: #cons { head: 2, tail: #cons { head: 1, tail: #nil ! } } };
		`,
		);
		script(
			"094 ordered list construction rejects descending tail, amp",
			`
let orderedListTestFail = {
    let List
    : (a: Type) -> (p: a -> a -> Bool) -> Type
    = \\t -> \\p -> | #nil Unit
    | #cons { head: t, tail: List (t[| \\v -> p &head v |]) p };
    let ol
    : List Num (\\x -> \\y -> x < y )
    = #cons { head: 2, tail: #cons { head: 1, tail: #nil ! } };
    return 1;
};
		`,
		);
		/* A projection off a sibling field rather than a bare reference, so the label resolves and then is projected. */
		script("096 projection off a sibling, nu", `{ point: { x: 1, y: 2 }, halved: { a: $point.x / 2, b: $point.y / 2 } }`);
	});

	/* A dependent field referenced by another dependent field. The single-link cases resolve
	 * because the first link lands on a concrete type; here the meta for `b` holds `&a`, so
	 * anything that needs `c` has to walk `&b -> ?b -> &a -> ?a -> Num`. */
	describe("15 chained dependent references", () => {
		works("076 two links, type only", `{ let P: Type = { a: Num, b: &a, c: &b }; return P; }`);
		works("077 two links, value accepted", `{ let P: Type = { a: Num, b: &a, c: &b }; let p: P = { a: 1, b: 1, c: 1 }; return p; }`);
		rejects("078 last link must match", `{ let P: Type = { a: Num, b: &a, c: &b }; let p: P = { a: 1, b: 1, c: 2 }; return p; }`, "Cannot unify");
		rejects("079 middle link must match", `{ let P: Type = { a: Num, b: &a, c: &b }; let p: P = { a: 1, b: 2, c: 2 }; return p; }`, "Cannot unify");
		works("080 project through the chain", `{ let P: Type = { a: Num, b: &a, c: &b }; let p: P = { a: 1, b: 1, c: 1 }; return p.c; }`);
		/* `b: &a` types `b` by a's value, so `&b` is a num literal and `>` wants `Num`. Rejected, and
		 * correctly: flowing a literal type into its carrier is coercion, which yap has not defined. */
		rejects(
			"081 a dependent field does not coerce to its carrier in a refinement",
			`{ let P: Type = { a: Num, b: &a, c: Num[| \\v -> v > &b |] }; return P; }`,
			"Cannot unify",
		);
		/* The same intent through the liquid machinery: `b` carries `Num`, so `&b` is a `Num` and the
		 * chain reaches a term position without needing a coercion. */
		/* Projection off a record that is not concrete: `r.b`'s type is `r.a`, a projection stuck on
		 * the parameter, which only reduces once `f` is applied. The one case reaching that path. */
		works("085 abstract scrutinee keeps the projection stuck", `{ let P: Type = { a: Num, b: &a }; let f = \\(r: P) -> r.b; return f; }`);
		works("084 refinement carries the chain instead", `{ let P: Type = { a: Num, b: Num[| \\v -> v == &a |], c: Num[| \\v -> v > &b |] }; return P; }`);
		works("082 three links", `{ let P: Type = { a: Num, b: &a, c: &b, d: &c }; return P; }`);
		/* `b: &a` types `b` by the *value* of `a`, and that value is a literal, not `Num`. So a
		 * signature returning the carrier is ill-typed; only the dependent answer will do. */
		rejects(
			"083 a dependent field's type is the sibling's value, not its carrier",
			`{ let P: Type = { a: Num, b: &a }; let f: P -> Num = \\r -> r.b; return f; }`,
			"Cannot unify",
		);
	});
});
