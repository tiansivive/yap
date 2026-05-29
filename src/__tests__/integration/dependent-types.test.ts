import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Dependent Types", () => {
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
