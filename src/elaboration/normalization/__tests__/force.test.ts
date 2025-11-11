import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { mkCtx } from "../../inference/__tests__/util";

const show = (v: NF.Value, ctx: EB.Context) => NF.display(v, { env: ctx.env, zonker: ctx.zonker, metas: ctx.metas });

describe("Normalization: force() and apply()", () => {
	it("force resolves flexible metas via zonker mapping", () => {
		const ctx = mkCtx();
		// meta ?1 at level 0
		const flex = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
		// zonk it to a concrete literal
		ctx.zonker[1] = NF.Constructors.Lit(Lit.Num(1));

		const res = NF.force(ctx, flex);
		expect(res.type).toBe("Lit");
		expect({ pretty: show(res, ctx) }).toMatchSnapshot();
	});

	it("force leaves unsolved metas untouched (neutral)", () => {
		const ctx = mkCtx();
		const flex = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
		const res = NF.force(ctx, flex);
		// still neutral/flex
		expect(res.type === "Neutral").toBeTruthy();
		expect({ pretty: show(res, ctx) }).toMatchSnapshot();
	});
});
