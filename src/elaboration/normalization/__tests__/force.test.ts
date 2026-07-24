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

	it("force preserves symbolic rigids and labels", () => {
		const ctx = mkCtx();
		const rigid = NF.Constructors.Rigid(0);
		const label = NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: "point" }));

		expect(NF.force(ctx, rigid)).toBe(rigid);
		expect(NF.view(ctx, rigid).kind).toBe("Symbolic");
		expect(NF.force(ctx, label)).toBe(label);
		expect(NF.view(ctx, label).kind).toBe("Symbolic");
	});

	it("force resolves labels through concrete sigma values", () => {
		const label = NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: "point" }));
		const point = NF.Constructors.Lit(Lit.Num(1));
		const ctx = { ...mkCtx(), sigma: { point: { value: point } } };

		expect(NF.force(ctx, label)).toBe(point);
		expect(NF.view(ctx, label).kind).toBe("Sealed");
	});

	it("force leaves symbolic sigma placeholders unresolved", () => {
		const label = NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: "point" }));
		const placeholder = NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: "point" }));
		const ctx = { ...mkCtx(), sigma: { point: { value: placeholder } } };

		expect(NF.force(ctx, label)).toBe(label);
		expect(NF.view(ctx, label).kind).toBe("Symbolic");
	});

	it("seals opaque foreign application spines", () => {
		const ctx = mkCtx();
		const foreign = NF.Constructors.Var({ type: "Foreign", name: "opaque" });
		const value = NF.reduce(foreign, NF.Constructors.Lit(Lit.Num(1)), "Explicit");
		const indexed = NF.Constructors.Indexed(
			NF.Constructors.Lit(Lit.Atom("Num")),
			NF.Constructors.Lit(Lit.Atom("Num")),
			NF.Constructors.Var({ type: "Foreign", name: "defaultArray" }),
		);

		expect(NF.view(ctx, value).kind).toBe("Sealed");
		expect(NF.view(ctx, indexed)).toMatchObject({ kind: "Sealed", value: NF.Patterns.Indexed });
	});

	it("seals deferred recursive applications", () => {
		const ctx = mkCtx();
		const mu = NF.Constructors.Mu("Loop", "Loop", NF.Type, NF.Constructors.Closure(ctx, EB.Constructors.Var({ type: "Bound", index: 0 })));
		const value = NF.reduce(mu, NF.Type, "Explicit");

		expect(NF.view(ctx, value).kind).toBe("Sealed");
	});

	it("seals recursive references and their applications", () => {
		const outer = mkCtx();
		const mu = NF.Constructors.Mu("Loop", "Loop", NF.Type, NF.Constructors.Closure(outer, EB.Constructors.Var({ type: "Bound", index: 0 })));
		const ctx = EB.extend(outer, { type: "Mu", variable: "Loop" }, mu);
		const reference = NF.evaluate(ctx, EB.Constructors.Var({ type: "Bound", index: 0 }));
		const application = NF.reduce(reference, NF.Type, "Explicit");

		expect(NF.view(ctx, reference).kind).toBe("Sealed");
		expect(NF.view(ctx, application).kind).toBe("Sealed");
	});
});
