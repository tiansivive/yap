import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lib from "@yap/shared/lib/primitives";
import * as Lit from "@yap/shared/literals";

import { elaborateFrom, mkCtx } from "../../inference/__tests__/util";

const ctxFor = (base = mkCtx(), metas: EB.Context["metas"] = {}) => ({
	...base,
	metas: { ...base.metas, ...metas },
});

const show = (v: NF.Value, ctx: EB.Context) => NF.display(v, { env: ctx.env, zonker: ctx.zonker, metas: ctx.metas });

describe("Normalization: evaluation / reduce / matching", () => {
	it("evaluates literals and arithmetic to WHNF", () => {
		const { structure } = elaborateFrom("1 + 2");
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = NF.evaluate(ctx, structure.term);

		// WHNF check: should be a literal after computing FFI op
		expect(nf.type).toBe("Lit");
		expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
	});

	it("evaluates lambda application via reduce to WHNF", () => {
		const { structure } = elaborateFrom("(\\x -> x) 1");
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = NF.evaluate(ctx, structure.term);
		expect(nf.type).toBe("Lit");
		expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
	});

	it("evaluates rows + projection", () => {
		const { structure } = elaborateFrom("{ x: 1, y: 2 }.x");
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = NF.evaluate(ctx, structure.term);
		expect(nf.type).toBe("Lit");
		expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
	});

	it("pattern matches on a struct", () => {
		const src = ["match { a: 1, b: 2}", "  | { a: x, b: y } -> x", "  | _ -> 0"].join("\n");
		const { structure } = elaborateFrom(src);
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = NF.evaluate(ctx, structure.term);
		expect(nf.type).toBe("Lit");
		expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
	});
});
