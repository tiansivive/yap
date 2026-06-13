import { describe, expect, it } from "vitest";
import { Build } from "../../../ivl/build";
import * as DSL from "../../../ivl/dsl";
import { separate } from "../separate";

describe("separate", () => {
	it("separates quantified clauses from propositional clauses", () => {
		const quantified = Build.forall([{ name: "x", sort: Build.Int }], DSL.gt(Build.var_("x", Build.Int), DSL.int(0)));
		const result = separate(DSL.and(DSL.eq(DSL.x, DSL.int(1)), quantified));

		expect(result.quantifiers).toHaveLength(1);
		expect(result.propositional.tag).toBe("Atom");
	});
});
