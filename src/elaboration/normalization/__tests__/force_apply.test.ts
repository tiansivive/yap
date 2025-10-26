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
		ctx.zonker[1] = NF.Constructors.Lit(Lit.Num(7));

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

	it("apply substitutes value into closure for Lambda binder", () => {
		const ctx = mkCtx();
		const body = EB.Constructors.Var({ type: "Bound", index: 0 });
		const binder: EB.Binding = { type: "Lambda", variable: "x", icit: "Explicit", annotation: EB.Constructors.Lit(Lit.Atom("Any")) } as any;
		const clo = NF.Constructors.Closure(ctx, body);
		const arg = NF.Constructors.Lit(Lit.Num(10));

		const res = NF.apply(binder, clo, arg);
		expect(res.type).toBe("Lit");
		expect({ pretty: show(res, ctx) }).toMatchSnapshot();
	});

	it("apply also works with Pi binder closures (body position)", () => {
		const ctx = mkCtx();
		const body = EB.Constructors.Var({ type: "Bound", index: 0 });
		const binder: EB.Binding = { type: "Pi", variable: "x", icit: "Explicit", annotation: EB.Constructors.Lit(Lit.Atom("Any")) } as any;
		const clo = NF.Constructors.Closure(ctx, body);
		const arg = NF.Constructors.Lit(Lit.Num(5));

		const res = NF.apply(binder, clo, arg);
		expect(res.type).toBe("Lit");
		expect({ pretty: show(res, ctx) }).toMatchSnapshot();
	});
});
