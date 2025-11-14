import { describe, it, expect, beforeEach } from "vitest";
import { elaborateFrom } from "../inference/__tests__/util";

import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";

describe("Let-polymorphism", () => {
	describe("basic polymorphic let bindings", () => {
		it("polymorphic identity function used at different types", () => {
			const src = `{
				let id = \\x -> x;
				let a = id 5;
				let b = id "hello";
			}`;

			const res = elaborateFrom(src);

			// The block should elaborate successfully
			expect(res.structure.term.type).toBe("Block");

			// Constraints may exist but should not cause type errors
			// (constraints are solved during letdec elaboration)

			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("polymorphic const function (K combinator)", () => {
			const src = `{
				let const = \\x -> \\y -> x;
				let numResult = const 5 42;
				let strResult = const "kept" 100;
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it.skip("polymorphic composition (B combinator)", () => {
			const src = `{
				let compose = \\f -> \\g -> \\x -> f (g x);
				let inc = \\n -> n;
				let result = compose inc inc;
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("higher-order polymorphic function", () => {
			const src = `{
				let apply = \\f -> \\x -> f x;
				let id = \\y -> y;
				let result = apply id 5;
			}`;

			const res = elaborateFrom(src);

			// apply's parameter `f` is monomorphic within the lambda body
			// but `id` is polymorphic when let-bound
			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("polymorphic hof applied to row literals", () => {
			const src = `{
				let apply = \\f -> \\x -> f x;
				let id = \\y -> y;
				let result = apply id ([ bar: Num]);
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});
	});

	describe("nested let bindings", () => {
		it("nested polymorphic lets", () => {
			const src = `{
				let outer = \\x -> {
					let inner = \\y -> y;
					let a = inner x;
					let b = inner 42;
				};
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("shadowing polymorphic lets", () => {
			const src = `{
				let id = \\x -> x;
				let a = id 5;
				let id = \\y -> y;
				let b = id "hello";
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});
	});

	// describe("let vs lambda: monomorphism restriction", () => {

	// 	// Note: This test demonstrates that lambda parameters are monomorphic
	// 	// The following would fail if uncommented because `id` would be monomorphic:
	// 	// it("lambda-bound parameter is monomorphic (would fail)", () => {
	// 	//   const src = `(\\id -> (id 5, id "world")) (\\x -> x)`;
	// 	//   expect(() => elaborateFrom(src)).toThrow();
	// 	// });

	// });

	describe("recursive bindings", () => {
		it("simple recursive function", () => {
			const src = `{
				let rec = \\x -> rec x;
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("recursive function with polymorphic usage", () => {
			const src = `{
				let const = \\x -> \\y -> const x y;
				let a = const 5;
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});
	});

	describe("let-polymorphism with complex types", () => {
		it("polymorphic function with projection", () => {
			const src = `{
				let fst = \\p -> p.x;
				let val1 = { x: 1, y: 2 };
				let val2 = { x: true, y: false };
				let a = fst val1;
				let b = fst val2;
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("polymorphic function with struct values", () => {
			const src = `{
				let getName = \\obj -> obj.name;
				let a = getName { name: "Alice" };
				let b = getName { name: "Bob", age: 30 };
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});
	});

	describe("let-polymorphism scope and capture", () => {
		it("polymorphic let in nested scope", () => {
			const src = `{
				let outer = 42;
				let inner = {
					let poly = \\x -> x;
					let a = poly outer;
					let b = poly "test";
					return poly;
				};
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("let-bound closure capturing polymorphic function", () => {
			const src = `{
				let id = \\x -> x;
				let makeApply = \\y -> id y;
				let a = makeApply 5;
				let b = makeApply "hello";
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});
	});

	describe("edge cases", () => {
		it("let with unused polymorphic binding", () => {
			const src = `{
				let id = \\x -> x;
				let result = 42;
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("multiple sequential polymorphic lets", () => {
			const src = `{
				let id1 = \\x -> x;
				let id2 = \\y -> y;
				let id3 = \\z -> z;
				let a = id1 1;
				let b = id2 true;
				let c = id3 42;
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("polymorphic let returning polymorphic function", () => {
			const src = `{
				let makeId = \\u -> \\x -> x;
				let id1 = makeId 1;
				let id2 = makeId true;
				let a = id1 "hello";
				let b = id2 "world";
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});
	});
});
