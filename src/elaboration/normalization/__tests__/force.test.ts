import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { mkCtx, runNF } from "../../inference/__tests__/util";
import * as Metas from "@yap/elaboration/shared/metas";

const show = (v: NF.Value, ctx: EB.Context) => NF.display(v, { env: ctx.env, zonker: ctx.zonker, metas: ctx.metas });

describe("Normalization: force() and apply()", () => {
	it("force resolves flexible metas via zonker mapping", () => {
		const ctx = mkCtx();
		// meta ?1 at level 0
		const flex = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
		// solve it to a concrete literal in the registry
		const registry = Metas.solve(
			Metas.register(Metas.empty, { meta: { type: "Meta", val: 1, lvl: 0 }, annotation: NF.Type }),
			1,
			NF.Constructors.Lit(Lit.Num(1)),
		);

		const res = runNF(ctx, () => NF.force(flex), registry);
		expect(res.type).toBe("Lit");
		expect({ pretty: show(res, ctx) }).toMatchSnapshot();
	});

	it("force leaves unsolved metas untouched (neutral)", () => {
		const ctx = mkCtx();
		const flex = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
		const res = runNF(ctx, () => NF.force(flex));
		// still neutral/flex
		expect(res.type === "Neutral").toBeTruthy();
		expect({ pretty: show(res, ctx) }).toMatchSnapshot();
	});

	it("force preserves symbolic rigids and labels", () => {
		const ctx = mkCtx();
		const rigid = NF.Constructors.Rigid(0);
		const label = NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: "point" }));

		expect(runNF(ctx, () => NF.force(rigid))).toBe(rigid);
		expect(runNF(ctx, () => NF.view(rigid)).kind).toBe("Symbolic");
		expect(runNF(ctx, () => NF.force(label))).toBe(label);
		expect(runNF(ctx, () => NF.view(label)).kind).toBe("Symbolic");
	});

	it("force resolves labels through concrete sigma values", () => {
		const label = NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: "point" }));
		const point = NF.Constructors.Lit(Lit.Num(1));
		const ctx = { ...mkCtx(), sigma: { point: { value: point } } };

		expect(runNF(ctx, () => NF.force(label))).toBe(point);
		expect(runNF(ctx, () => NF.view(label)).kind).toBe("Sealed");
	});

	it("force leaves symbolic sigma placeholders unresolved", () => {
		const label = NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: "point" }));
		const placeholder = NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: "point" }));
		const ctx = { ...mkCtx(), sigma: { point: { value: placeholder } } };

		expect(runNF(ctx, () => NF.force(label))).toBe(label);
		expect(runNF(ctx, () => NF.view(label)).kind).toBe("Symbolic");
	});

	it("seals opaque foreign application spines", () => {
		const ctx = mkCtx();
		const foreign = NF.Constructors.Var({ type: "Foreign", name: "opaque" });
		const value = runNF(ctx, () => NF.reduce(foreign, NF.Constructors.Lit(Lit.Num(1)), "Explicit"));
		const indexed = NF.Constructors.Indexed(
			NF.Constructors.Lit(Lit.Atom("Num")),
			NF.Constructors.Lit(Lit.Atom("Num")),
			NF.Constructors.Var({ type: "Foreign", name: "defaultArray" }),
		);

		expect(runNF(ctx, () => NF.view(value)).kind).toBe("Sealed");
		expect(runNF(ctx, () => NF.view(indexed))).toMatchObject({ kind: "Sealed", value: NF.Patterns.Indexed });
	});

	it("seals deferred recursive applications", () => {
		const ctx = mkCtx();
		const mu = NF.Constructors.Mu("Loop", "Loop", NF.Type, NF.Constructors.Closure(ctx, EB.Constructors.Var({ type: "Bound", index: 0 })));
		const value = runNF(ctx, () => NF.reduce(mu, NF.Type, "Explicit"));

		expect(runNF(ctx, () => NF.view(value)).kind).toBe("Sealed");
	});

	it("seals recursive references and their applications", () => {
		const outer = mkCtx();
		const mu = NF.Constructors.Mu("Loop", "Loop", NF.Type, NF.Constructors.Closure(outer, EB.Constructors.Var({ type: "Bound", index: 0 })));
		const ctx = EB.extend(outer, { type: "Mu", variable: "Loop" }, mu);
		const reference = runNF(ctx, () => NF.normalize(EB.Constructors.Var({ type: "Bound", index: 0 })));
		const application = runNF(ctx, () => NF.reduce(reference, NF.Type, "Explicit"));

		expect(runNF(ctx, () => NF.view(reference)).kind).toBe("Sealed");
		expect(runNF(ctx, () => NF.view(application)).kind).toBe("Sealed");
	});
});
