import { describe, it, expect } from "vitest";
import * as E from "fp-ts/lib/Either";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { parseExpr, mkCtx, runNF, shown } from "../../inference/__tests__/util";

describe("module.expression elaboration", () => {
	it('elaborates and evaluates (\\x => \\(y: String) -> y) "hello" without crashing', () => {
		EB.resetSupply("meta");
		EB.resetSupply("var");
		EB.resetId();
		NF.resetId();

		const src = '(\\x => \\(y: String) -> y) "hello"';
		const term = parseExpr(src);
		const ctx = mkCtx();

		const [elaborated, boundary] = EB.Mod.expression({ type: "expression", value: term, location: term.location }, ctx);
		expect(E.isRight(elaborated)).toBe(true);
		if (E.isLeft(elaborated)) {
			return;
		}

		const [tm, , , finalCtx] = elaborated.right;
		expect(() => runNF(finalCtx, () => NF.normalize(tm), boundary.registry)).not.toThrow();
	});

	it("let-binding does not leak inner metas: { let id = \\x -> x; return id 42; }", () => {
		EB.resetSupply("meta");
		EB.resetSupply("var");
		EB.resetId();
		NF.resetId();

		const src = "{ let id = \\x -> x; return id 42; }";
		const term = parseExpr(src);
		const ctx = mkCtx();

		const [elaborated, boundary] = EB.Mod.expression({ type: "expression", value: term, location: term.location }, ctx);
		expect(E.isRight(elaborated)).toBe(true);

		if (E.isLeft(elaborated)) {
			return;
		}

		const [, ty] = elaborated.right;
		const displayed = shown(ctx, boundary.registry)(() => NF.display(ty));
		expect(displayed).toBe("Num");
	});
});
