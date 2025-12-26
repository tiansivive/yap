import { describe, expect, it } from "vitest";

import { elaborate } from "./utils";

describe("dependent types elaboration", () => {
	it("simple dependent match expression type", () => {
		const src = `let f
				: (x: Num) -> (match x | 0 -> Num | _ -> String) 
				= \\x -> match x
					| 0 -> 10
					| _ -> "10"`;

		const { pretty, structure } = elaborate(src);

		expect(pretty).toMatchSnapshot();
	});

	it("rejects invalid dependent match alternative", () => {
		const src = `let f
                : (x: Num) -> (match x | 0 -> Num | _ -> String) 
                = \\x -> match x
                    | 0 -> "hello"
                    | _ -> "10"`;
		expect(() => elaborate(src)).toThrow("Unification Failure: Cannot unify String with Num");
	});

	it.skip("handles dependent arg", () => {
		const src = `let process
            : (b: Bool) -> (v: match b | true -> Num | false -> String) -> String
            = \\b v -> match b
                | true  -> v
                | false -> v`;
		const { pretty, structure } = elaborate(src);

		expect(pretty).toMatchSnapshot();
	});
});
