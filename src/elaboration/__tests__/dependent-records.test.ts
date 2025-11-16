import { describe, it, expect, beforeEach } from "vitest";
import { elaborateFrom } from "../inference/__tests__/util";

import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";

describe("Dependent Records", () => {
	describe("dependent pairs with path-dependent types", () => {
		it("Pair: dependent pair with type dependent on first component", () => {
			const src = `{
				let Pair
					: (a: Type) -> (p: a -> Type) -> Type
					= \\a -> \\p -> { fst: a, snd: p :fst };
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("Pair instantiated with Num and String", () => {
			const src = `{
				let Pair
					: (a: Type) -> (p: a -> Type) -> Type
					= \\a -> \\p -> { fst: a, snd: p :fst };
				
				let p
					: Pair Num (\\n -> String)
					= { fst: 1, snd: "hello" };
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});
	});

	describe("dependent pairs with refinement types", () => {
		it("Dependent pair with refined second component", () => {
			const src = `{
				let Pair
					: (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
					= \\a -> \\b -> \\p -> { fst: a, snd: b[| \\v -> p :fst v |] };
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});

		it("Dependent pair instantiated with less-than constraint", () => {
			const src = `{
				let Pair
					: (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
					= \\a -> \\b -> \\p -> { fst: a, snd: b[| \\v -> p :fst v |] };
				
				let pair
					: Pair Num Num (\\x -> \\y -> x < y )
					= { fst: 3, snd: 5 };
			}`;

			const res = elaborateFrom(src);

			expect(res.structure.term.type).toBe("Block");
			expect({ displays: res.displays }).toMatchSnapshot();
			expect({ structure: res.structure }).toMatchSnapshot();
		});
	});
});
