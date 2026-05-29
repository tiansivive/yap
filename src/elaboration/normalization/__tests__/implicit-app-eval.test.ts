import { describe, it, expect } from "vitest";
import * as E from "fp-ts/lib/Either";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Eval from "../evaluation.v2";
import { parseExpr, mkCtx } from "../../inference/__tests__/util";

describe("module.expression elaboration", () => {
	it('elaborates and evaluates (\\x => \\(y: String) -> y) "hello" without crashing', () => {
		EB.resetSupply("meta");
		EB.resetSupply("var");
		EB.resetId();
		NF.resetId();

		const src = '(\\x => \\(y: String) -> y) "hello"';
		const term = parseExpr(src);
		const ctx = mkCtx();

		const elaborated = EB.Mod.expression({ type: "expression", value: term }, ctx);
		expect(E.isRight(elaborated)).toBe(true);
		if (E.isLeft(elaborated)) {
			return;
		}

		const [tm, , , finalCtx] = elaborated.right;
		expect(() => Eval.evaluate(finalCtx, tm)).not.toThrow();
	});

	it("let-binding does not leak inner metas: { let id = \\x -> x; return id 42; }", () => {
		EB.resetSupply("meta");
		EB.resetSupply("var");
		EB.resetId();
		NF.resetId();

		const src = "{ let id = \\x -> x; return id 42; }";
		const term = parseExpr(src);
		const ctx = mkCtx();

		const elaborated = EB.Mod.expression({ type: "expression", value: term }, ctx);
		expect(E.isRight(elaborated)).toBe(true);

		if (E.isLeft(elaborated)) {
			return;
		}

		const [, ty] = elaborated.right;
		const displayed = NF.display(ty, { env: ctx.env, zonker: {}, metas: {} });
		expect(displayed).toBe("Num");
	});
});
