import { describe, expect, it } from "vitest";
import { match } from "ts-pattern";
import { Build } from "../../../ivl/build";
import * as DSL from "../../../ivl/dsl";
import { skolemize } from "../skolem";

describe("skolemize", () => {
	it("skolemizes existentials under universal binders", () => {
		const formula = Build.forall(
			[{ name: "x", sort: Build.Int }],
			Build.exists([{ name: "y", sort: Build.Int }], DSL.eq(Build.var_("y", Build.Int), Build.var_("x", Build.Int))),
		);

		const result = skolemize(formula);

		match(result)
			.with({ tag: "Forall", body: { tag: "Atom" } }, ({ body }) => {
				expect(body.args[0]).toMatchObject({ tag: "App", head: "sk_0" });
			})
			.otherwise(() => expect.unreachable());
	});
});
