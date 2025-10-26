import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { mkCtx } from "../../inference/__tests__/util";

const showNF = (v: NF.Value, ctx: EB.Context) => NF.display(v, { env: ctx.env, zonker: ctx.zonker, metas: ctx.metas });
const showEB = (t: EB.Term, ctx: EB.Context) => EB.Display.Term(t, { env: ctx.env, zonker: ctx.zonker, metas: ctx.metas });

describe("Normalization: quoting and generalization", () => {
	it("quotes a lambda with body referencing the binder", () => {
		const ctx = mkCtx();
		const body = EB.Constructors.Var({ type: "Bound", index: 0 });
		const lam = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure(ctx, body), NF.Any);

		const quoted = NF.quote(ctx, 0, lam);

		expect({ pretty: showEB(quoted, ctx) }).toMatchSnapshot();
	});

	it("generalizes metas into implicit Pis and preserves zonker in extended ctx", () => {
		const ctx = mkCtx();
		// create a meta ?1 and annotate it with Type
		(ctx.metas as any)[1] = { meta: EB.Constructors.Vars.Meta(1, 0) as any, ann: NF.Type } as any;

		const flex = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });

		const [gen, ext] = NF.generalize(flex, ctx);

		expect({ nf: showNF(gen, ext) }).toMatchSnapshot();

		// also quote the generalized NF back to EB for readability
		const quoted = NF.quote(ext, 0, gen);
		expect({ eb: showEB(quoted, ext) }).toMatchSnapshot();
	});

	it("instantiate defaults: Type -> Any, Row -> []", () => {
		const ctx = mkCtx();

		// Meta 2 :: Type
		(ctx.metas as any)[2] = { meta: EB.Constructors.Vars.Meta(2, 0) as any, ann: NF.Type } as any;
		const vTypeMeta = NF.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
		const iType = NF.instantiate(vTypeMeta, ctx);
		expect({ pretty: showNF(iType, ctx) }).toMatchSnapshot();

		// Meta 3 :: Row
		(ctx.metas as any)[3] = { meta: EB.Constructors.Vars.Meta(3, 0) as any, ann: NF.Row } as any;
		const vRowMeta = NF.Constructors.Var({ type: "Meta", val: 3, lvl: 0 });
		const iRow = NF.instantiate(vRowMeta, ctx);
		expect({ pretty: showNF(iRow, ctx) }).toMatchSnapshot();
	});
});
