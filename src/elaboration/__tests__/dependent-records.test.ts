import { describe, it, expect } from "vitest";
import { elaborateFrom } from "../inference/__tests__/util";

describe("Dependent Records", () => {
	describe("dependent pairs with path-dependent types", () => {
		it("Simple dependent pair", () => {
			const src = `{
				let Pair
					: Type
					= { fst: Num, snd: &fst };
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
		});

		it("Dependent pair: matching singleton values pass", () => {
			const src = `{
				let Pair: Type = { fst: Num, snd: &fst };
				let p: Pair = { fst: 1, snd: 1 };
				return p;
			}`;

			const res = elaborateFrom(src);
			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
		});

		it("Dependent pair: mismatched singleton values fail", () => {
			const src = `{
				let Pair: Type = { fst: Num, snd: &fst };
				let p: Pair = { fst: 1, snd: 5 };
				return p;
			}`;

			expect(() => elaborateFrom(src)).toThrow(/Cannot unify/);
		});

		it("Pair: dependent pair with type dependent on first component", () => {
			const src = `{
				let Pair
					: (a: Type) -> (p: a -> Type) -> Type
					= \\a -> \\p -> { fst: a, snd: p &fst };
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
		});

		it("Pair instantiated with Num and String", () => {
			const src = `{
				let Pair
					: (a: Type) -> (p: a -> Type) -> Type
					= \\a -> \\p -> { fst: a, snd: p &fst };
				
				let p
					: Pair Num (\\n -> String)
					= { fst: 1, snd: "hello" };
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
		});
	});

	describe("dependent pairs with refinement types", () => {
		it("Dependent pair with refined second component", () => {
			const src = `{
				let Pair
					: (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
					= \\a -> \\b -> \\p -> { fst: a, snd: b[| \\v -> p &fst v |] };
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
		});
	});

	describe("SigmaV2 label scope", () => {
		it("rejects a dependent label outside a SigmaV2 schema", () => {
			expect(() => elaborateFrom("{ n: Num, m: &n }")).toThrow("No enclosing record field named n");
		});

		it("resolves outer labels and nearest nested labels", () => {
			const outer = elaborateFrom(`{
				let P: Type = { a: Num, b: { c: &a } };
				return P;
			}`);
			expect(outer.structure.term.type).toBe("Block");

			const shadowed = elaborateFrom(`{
				let P: Type = { a: Num, b: { a: String, c: &a } };
				return P;
			}`);
			expect(shadowed.structure.term.type).toBe("Block");
		});

		it("rejects an unknown nested dependent label", () => {
			expect(() => elaborateFrom(`{ let P: Type = { a: Num, b: { c: &nope } }; return P; }`)).toThrow("No enclosing record field named nope");
		});
	});

	describe("SigmaV2 schema interaction", () => {
		it("accepts inferred structs at annotated SigmaV2 boundaries", () => {
			const src = `{
				let P: Type = { a: Num };
				let f = \\(x: { a: Num }) -> x.a;
				let v = { a: 1 };
				let p: P = v;
				return f p;
			}`;
			const res = elaborateFrom(src);
			expect(res.structure.term.type).toBe("Block");
		});
	});

	describe("chained dependent classifiers", () => {
		it("propagates a dependent field's singleton classifier through a chain", () => {
			const res = elaborateFrom(`{
				let P: Type = { a: Num, b: &a, c: &b, d: &c };
				let p: P = { a: 1, b: 1, c: 1, d: 1 };
				return p.d;
			}`);
			expect(res.structure.term.type).toBe("Block");
		});

		it("rejects a dependent classifier mismatch", () => {
			expect(() => elaborateFrom(`{ let P: Type = { a: Num, b: &a, c: &b }; let p: P = { a: 1, b: 1, c: 2 }; return p; }`)).toThrow("Cannot unify");
		});

		it("preserves residual dependent projections and refinement chains", () => {
			const abstract = elaborateFrom(`{
				let P: Type = { a: Num, b: &a };
				let f = \\(r: P) -> r.b;
				return f;
			}`);
			expect(abstract.structure.term.type).toBe("Block");

			const refinements = elaborateFrom(`{
				let P: Type = { a: Num, b: Num[| \\v -> v == &a |], c: Num[| \\v -> v > &b |] };
				return P;
			}`);
			expect(refinements.structure.term.type).toBe("Block");
		});

		it("rejects treating a dependent singleton as its carrier", () => {
			expect(() => elaborateFrom(`{ let P: Type = { a: Num, b: &a }; let f: P -> Num = \\r -> r.b; return f; }`)).toThrow("Cannot unify");
		});
	});
});
