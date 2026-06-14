import { describe, expect, it } from "vitest";
import * as DSL from "../../../ivl/dsl";
import { CNF, Lookup } from "../index";

describe("lookup", () => {
	it("finds complementary atoms in the existing CNF abstraction", () => {
		const encoded = CNF.encode(DSL.gt(DSL.x, DSL.int(0)));
		const literals = Lookup.literals(encoded, DSL.lte(DSL.x, DSL.int(0)));

		expect(literals).toHaveLength(1);
		expect(literals[0]).toBeLessThan(0);
	});

	it("ignores atoms outside the existing CNF abstraction", () => {
		const encoded = CNF.encode(DSL.gt(DSL.x, DSL.int(0)));
		const literals = Lookup.literals(encoded, DSL.eq(DSL.y, DSL.int(1)));

		expect(literals).toEqual([]);
	});
});
