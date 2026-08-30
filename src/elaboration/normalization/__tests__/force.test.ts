import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { mkCtx, runNF, shown } from "../../inference/__tests__/util";
import * as Metas from "@yap/elaboration/shared/metas";
import * as R from "@yap/shared/rows";

const show = (v: NF.Value, ctx: EB.Context, registry: Metas.Registry = {}) => shown(ctx, registry)(() => NF.display(v));

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

	it("turns symbolic applications into blocked residuals", () => {
		const ctx = mkCtx();
		const flex = NF.Constructors.Flex({ type: "Meta", val: 3, lvl: 0 });
		const arg = NF.Constructors.Lit(Lit.Num(1));
		const application = runNF(ctx, () => NF.reduce(flex, arg, "Explicit"));

		expect(application).toMatchObject({
			type: "Neutral",
			kind: "Blocked",
			value: {
				type: "App",
				func: {
					type: "Neutral",
					kind: "Symbolic",
					value: { type: "Var", variable: { type: "Meta", val: 3 } },
				},
				arg,
			},
		});
	});

	it("lifts one blocked wrapper over a binary application chain", () => {
		const ctx = mkCtx();
		const flex = NF.Constructors.Flex({ type: "Meta", val: 4, lvl: 0 });
		const first = NF.Constructors.Lit(Lit.Num(1));
		const second = NF.Constructors.Lit(Lit.Num(2));
		const partial = runNF(ctx, () => NF.reduce(flex, first, "Explicit"));
		const application = runNF(ctx, () => NF.reduce(partial, second, "Explicit"));

		expect(application).toMatchObject({
			type: "Neutral",
			kind: "Blocked",
			value: {
				type: "App",
				func: {
					type: "App",
					func: { type: "Neutral", kind: "Symbolic" },
					arg: first,
				},
				arg: second,
			},
		});
	});

	it("resumes a solved head through the complete binary application chain", () => {
		const ctx = mkCtx();
		const meta = { type: "Meta", val: 5, lvl: 0 } as const;
		const flex = NF.Constructors.Flex(meta);
		const first = NF.Constructors.Lit(Lit.Num(1));
		const second = NF.Constructors.Lit(Lit.Num(2));
		const partial = runNF(ctx, () => NF.reduce(flex, first, "Explicit"));
		const application = runNF(ctx, () => NF.reduce(partial, second, "Explicit"));
		const chooseFirst = NF.Constructors.External("chooseFirst", 2, value => value, []);
		const registry = Metas.solve(Metas.register(Metas.empty, { meta, annotation: NF.Type }), meta.val, chooseFirst);

		expect(runNF(ctx, () => NF.force(application), registry)).toBe(first);
	});

	it("computes saturated externals with sealed operands", () => {
		const ctx = mkCtx();
		const sealed = NF.Constructors.Neutral("Sealed", NF.Constructors.Lit(Lit.Num(7)));
		const result = NF.Constructors.Lit(Lit.Num(9));
		const external = NF.Constructors.External("acceptSealed", 1, () => result, []);
		const stale = NF.Constructors.Neutral(
			"Blocked",
			NF.Constructors.External("acceptSealed", 1, () => result, [sealed]),
		);

		expect(runNF(ctx, () => NF.reduce(external, sealed, "Explicit"))).toBe(result);
		expect(runNF(ctx, () => NF.force(stale))).toBe(result);
	});

	it("keeps saturated externals blocked on symbolic operands", () => {
		const ctx = mkCtx();
		const symbolic = NF.Constructors.Flex({ type: "Meta", val: 6, lvl: 0 });
		const external = NF.Constructors.External("needsConcrete", 1, () => NF.Type, []);
		const application = runNF(ctx, () => NF.reduce(external, symbolic, "Explicit"));

		expect(application).toMatchObject({
			type: "Neutral",
			kind: "Blocked",
			value: { type: "External", args: [symbolic] },
		});
		expect(runNF(ctx, () => NF.force(application))).toBe(application);
	});

	it("forces sealed boundaries shallowly", () => {
		const ctx = mkCtx();
		const meta = { type: "Meta", val: 7, lvl: 0 } as const;
		const structure = NF.Constructors.Struct(NF.Constructors.Extension("x", NF.Constructors.Flex(meta), R.Constructors.Empty()));
		const registry = Metas.solve(Metas.register(Metas.empty, { meta, annotation: NF.Type }), meta.val, NF.Constructors.Lit(Lit.Num(42)));

		expect(runNF(ctx, () => NF.force(structure), registry)).toBe(structure);
	});

	it("does not dispatch the protected head of a sealed boundary", () => {
		const ctx = mkCtx();
		const result = NF.Constructors.Lit(Lit.Num(42));
		const head = NF.Constructors.External("protected", 1, () => result, []);
		const sealed = NF.Constructors.Neutral("Sealed", NF.Constructors.App(head, NF.Constructors.Lit(Lit.Num(1)), "Explicit"));

		expect(runNF(ctx, () => NF.force(sealed))).toBe(sealed);
	});

	it("lets meet own the view required by inspecting patterns", () => {
		const ctx = mkCtx();
		const value = NF.Constructors.Struct(NF.Constructors.Extension("x", NF.Constructors.Lit(Lit.Num(1)), R.Constructors.Empty()));
		const pattern = EB.Constructors.Patterns.Struct(EB.Constructors.Patterns.Extension("x", EB.Constructors.Patterns.Lit(Lit.Num(1)), R.Constructors.Empty()));

		expect(runNF(ctx, () => NF.meet(ctx, pattern, value))).toEqual({ tag: "matched", bindings: [] });
	});

	it("distinguishes non-observing matches from blocked observations", () => {
		const ctx = mkCtx();
		const symbolic = NF.Constructors.Flex({ type: "Meta", val: 8, lvl: 0 });

		expect(runNF(ctx, () => NF.meet(ctx, EB.Constructors.Patterns.Wildcard(), symbolic))).toEqual({ tag: "matched", bindings: [] });
		expect(runNF(ctx, () => NF.meet(ctx, EB.Constructors.Patterns.Lit(Lit.Num(1)), symbolic))).toEqual({ tag: "blocked" });
	});

	it("does not fall through an inspecting pattern while its scrutinee is unresolved", () => {
		const ctx = mkCtx();
		const meta = { type: "Meta", val: 9, lvl: 0 } as const;
		const term = EB.Constructors.Match(EB.Constructors.Var(meta), [
			EB.Constructors.Alternative(EB.Constructors.Patterns.Lit(Lit.Num(0)), EB.Constructors.Lit(Lit.Num(1)), []),
			EB.Constructors.Alternative(EB.Constructors.Patterns.Wildcard(), EB.Constructors.Lit(Lit.Num(2)), []),
		]);
		const stuck = runNF(ctx, () => NF.normalize(term));

		expect(stuck).toMatchObject({ type: "Neutral", kind: "Blocked", value: { type: "Match", scrutinee: { kind: "Symbolic" } } });

		const registry = Metas.solve(Metas.register(Metas.empty, { meta, annotation: NF.Type }), meta.val, NF.Constructors.Lit(Lit.Num(3)));
		expect(runNF(ctx, () => NF.force(stuck), registry)).toMatchObject({ type: "Lit", value: Lit.Num(2) });
	});
});
