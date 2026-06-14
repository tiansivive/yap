import { describe, expect, it } from "vitest";
import * as DSL from "../../../ivl/dsl";
import { CNF, Lemma } from "../index";

describe("lemma", () => {
	it("encodes complementary lemma atoms against existing CNF atoms", () => {
		const encoded = CNF.encode(DSL.gt(DSL.x, DSL.int(0)));
		const lemma = Lemma.encode(encoded, DSL.lte(DSL.x, DSL.int(0)));

		expect(lemma).toHaveLength(1);
		expect(lemma[0]).toBeLessThan(0);
	});
});
