import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { mkCtx } from "../../inference/__tests__/util";

import * as F from "fp-ts/function";

describe("Normalization: generalization", () => {
	describe("generalize", () => {
		it("simple meta: ?1 |=> Π(a: Type) => a", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };

			const meta = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const [generalized, z] = NF.generalize(meta, ctx);
			const extendedCtx = { ...ctx, zonker: z };
			// Should be wrapped in an implicit Pi
			const nf = NF.display(generalized, extendedCtx);
			expect(nf).toContain("=>");

			const quoted = NF.quote(extendedCtx, ctx.env.length, generalized);
			expect({
				nf,
				eb: EB.Display.Term(quoted, extendedCtx),
			}).toMatchSnapshot();

			// Extended context should have zonker entry for the meta
			expect(extendedCtx.zonker[1]).toBeDefined();
		});

		it("multiple metas: ?1 ?2 |=> Π(a: Type) => Π(b: Type) => a b", () => {
			const ctx = mkCtx();
			// Create metas ?1 :: Type and ?2 :: Type
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };

			// Create Pi type: ?1 -> ?2
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const piType = NF.Constructors.App(meta1, meta2, "Explicit");

			const [generalized, z] = NF.generalize(piType, ctx);
			const extendedCtx = { ...ctx, zonker: z };

			// Should be double-wrapped in implicit Pis
			const nf = NF.display(generalized, extendedCtx);
			const matches = nf.match(/=>/g) || [];
			expect(matches.length).toBe(2);

			const quoted = NF.quote(extendedCtx, 0, generalized);
			expect({
				nf,
				eb: EB.Display.Term(quoted, extendedCtx),
			}).toMatchSnapshot();

			// Both metas should be in zonker
			expect(extendedCtx.zonker[1]).toBeDefined();
			expect(extendedCtx.zonker[2]).toBeDefined();
		});

		it("uses alphabetic variable names (a, b, c...): ?1 ?2 ?3 |=> Π(a: Type) => Π(b: Type) => Π(c: Type) => a b c", () => {
			const ctx = mkCtx();

			// Create three metas
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };
			ctx.metas[3] = { meta: EB.Constructors.Vars.Meta(3, 0), ann: NF.Type };

			// Create a term with all three metas
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const meta3 = NF.Constructors.Flex({ type: "Meta", val: 3, lvl: 0 });

			// ?1 ?2 ?3
			const app1 = NF.Constructors.App(meta1, meta2, "Explicit");
			const app2 = NF.Constructors.App(app1, meta3, "Explicit");

			const [generalized, z] = NF.generalize(app2, ctx);
			const extendedCtx = { ...ctx, zonker: z };
			const display = NF.display(generalized, extendedCtx);

			// Should contain variable names a, b, c
			expect(display).toContain("a");
			expect(display).toContain("b");
			expect(display).toContain("c");

			const quoted = NF.quote(extendedCtx, 0, generalized);
			expect({ nf: display, eb: EB.Display.Term(quoted, extendedCtx) }).toMatchSnapshot();
		});

		it("handles pi types: ?1 -> ?2 -> ?3 |=> Π(a: Type) => Π(b: Type) => Π(c: Type) => Π(x: a) -> Π(y: b) -> c", () => {
			const ctx = mkCtx();
			// Create three metas
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };
			ctx.metas[3] = { meta: EB.Constructors.Vars.Meta(3, 0), ann: NF.Type };

			// Create a term with all three metas
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const meta3 = EB.Constructors.Var({ type: "Meta", val: 3, lvl: 0 });

			// ?1 -> ?2 -> ?3
			const inner = EB.Constructors.Pi("y", "Explicit", meta2, meta3);
			const outer = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(ctx, inner));

			const [generalized, z] = NF.generalize(outer, ctx);
			const extendedCtx = { ...ctx, zonker: z };

			const display = NF.display(generalized, extendedCtx);
			const quoted = NF.quote(extendedCtx, 0, generalized);
			expect({ nf: display, eb: EB.Display.Term(quoted, extendedCtx) }).toMatchSnapshot();
		});

		it("correctly types metas: (?1:Type) -> (?2: Row)  |=> Π(a: Type) => Π(b: Row) => Π(x: a) -> b", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Row };

			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const piType = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(ctx, meta2));

			const [generalized, z] = NF.generalize(piType, ctx);
			const extendedCtx = { ...ctx, zonker: z };

			const nf = NF.display(generalized, extendedCtx);
			expect(nf).toContain("a: Type");
			expect(nf).toContain("b: Row");

			const quoted = NF.quote(extendedCtx, 0, generalized);
			expect({
				nf,
				eb: EB.Display.Term(quoted, extendedCtx),
			}).toMatchSnapshot();
		});

		it("preserves already-solved metas in zonker", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };
			ctx.zonker[2] = NF.Constructors.Lit(Lit.Atom("Num"));

			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const piType = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(ctx, meta2));

			const [generalized, z] = NF.generalize(piType, ctx);
			const extendedCtx = { ...ctx, zonker: z };
			// Only ?1 should be generalized
			const nf = NF.display(generalized, extendedCtx);
			expect(nf).toContain("a: Type");
			expect(nf).toContain("-> Num");

			const quoted = NF.quote(extendedCtx, 0, generalized);
			expect({
				nf,
				eb: EB.Display.Term(quoted, extendedCtx),
			}).toMatchSnapshot();

			// Original zonker entry should be preserved
			expect(extendedCtx.zonker["2"]).toBeDefined();
		});

		it("returns the value unchanged when there are no metas to generalize", () => {
			const ctx = mkCtx();
			const numType = NF.Constructors.Lit(Lit.Atom("Num"));

			const [generalized, z] = NF.generalize(numType, ctx);
			const extendedCtx = { ...ctx, zonker: z };

			// Should be unchanged
			expect(generalized).toBe(numType);
			expect(extendedCtx).toStrictEqual(ctx);

			expect({ nf: NF.display(generalized, ctx) }).toMatchSnapshot();
		});

		it("introduces binder under existing environment entries", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			const xtended = EB.bind(ctx, { type: "Let", variable: "x" }, NF.Any);

			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const [generalized, z] = NF.generalize(meta1, xtended);
			const extendedCtx = { ...xtended, zonker: z };

			const quoted = NF.quote(extendedCtx, xtended.env.length, generalized);

			expect({ nf: NF.display(generalized, extendedCtx), eb: EB.Display.Term(quoted, extendedCtx) }).toMatchSnapshot();
		});

		it("introduces multiple binders under existing environment entries", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };
			const xtended = F.pipe(
				ctx,
				ctx => EB.bind(ctx, { type: "Let", variable: "x" }, NF.Any),
				ctx => EB.bind(ctx, { type: "Let", variable: "y" }, NF.Any),
			);

			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const app = NF.Constructors.App(meta1, meta2, "Explicit");

			const [generalized, z] = NF.generalize(app, xtended);
			const extendedCtx = { ...xtended, zonker: z };

			const quoted = NF.quote(extendedCtx, xtended.env.length, generalized);

			expect({ nf: NF.display(generalized, extendedCtx), eb: EB.Display.Term(quoted, extendedCtx) }).toMatchSnapshot();
		});

		it("handles pi types under existing environment entries", () => {
			const ctx = mkCtx();
			// Create three metas
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };

			const xtended = F.pipe(
				ctx,
				ctx => EB.bind(ctx, { type: "Let", variable: "one" }, NF.Any),
				ctx => EB.bind(ctx, { type: "Let", variable: "two" }, NF.Any),
			);

			// Create a term with both metas
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });

			// ?1 -> ?2
			const pi = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(xtended, meta2));
			const [generalized, z] = NF.generalize(pi, xtended);
			const extendedCtx = { ...xtended, zonker: z };

			const quoted = NF.quote(extendedCtx, xtended.env.length, generalized);
			expect({ nf: NF.display(generalized, extendedCtx), eb: EB.Display.Term(quoted, extendedCtx) }).toMatchSnapshot();
		});
	});

	describe("instantiate", () => {
		it("instantiates unconstrained Type meta to Any", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };

			const meta = NF.Constructors.Var({ type: "Meta", val: 1, lvl: 0 });

			const instantiated = NF.instantiate(meta, ctx);
			const nf = NF.display(instantiated, ctx);
			expect(nf).toBe("Any");

			expect({ nf }).toMatchSnapshot();
		});

		it("instantiates unconstrained Row meta to empty row", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Row };

			const meta = NF.Constructors.Var({ type: "Meta", val: 1, lvl: 0 });

			const instantiated = NF.instantiate(meta, ctx);
			const nf = NF.display(instantiated, ctx);
			expect(nf).toBe("[]");

			expect({ nf }).toMatchSnapshot();
		});

		it("leaves solved metas unchanged", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.zonker[1] = NF.Constructors.Lit(Lit.Atom("Num"));

			const meta = NF.Constructors.Var({ type: "Meta", val: 1, lvl: 0 });

			const instantiated = NF.instantiate(meta, ctx);
			const nf = NF.display(instantiated, ctx);
			expect(nf).toBe("Num");

			expect({ nf }).toMatchSnapshot();
		});

		it("leaves non-meta values unchanged", () => {
			const ctx = mkCtx();
			const numLit = NF.Constructors.Lit(Lit.Num(42));

			const instantiated = NF.instantiate(numLit, ctx);

			expect({ nf: NF.display(instantiated, ctx) }).toMatchSnapshot();
		});

		it("leaves bound variables unchanged", () => {
			const ctx = mkCtx();
			const boundVar = NF.Constructors.Var({ type: "Bound", lvl: 0 });

			const instantiated = NF.instantiate(boundVar, ctx);

			expect({ nf: NF.display(instantiated, ctx) }).toMatchSnapshot();
		});
	});

	describe("trimClosureEnvs", () => {
		it("trims the first env entry from closures", () => {
			const ctx = mkCtx();
			const extendedCtx = EB.bind(ctx, { type: "Let", variable: "rec" }, NF.Any);

			const body = EB.Constructors.Var({ type: "Bound", index: 0 });
			const pi = NF.Constructors.Pi("x", "Explicit", NF.Any, NF.Constructors.Closure(extendedCtx, body));

			const trimmed = NF.trimClosureEnvs(pi);

			if (trimmed.type !== "Abs" || trimmed.binder.type !== "Pi") {
				throw new Error("Expected Pi after trimming closure env");
			}

			expect(trimmed.closure.ctx.env).toHaveLength(0);

			expect({ nf: NF.display(trimmed, ctx) }).toMatchSnapshot();
		});
	});

	describe("integration: generalize + instantiate round-trip", () => {
		it("generalizes and then instantiates a polymorphic type", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };

			const meta = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });

			const [generalized, z] = NF.generalize(meta, ctx);
			const extendedCtx = { ...ctx, zonker: z };
			const instantiated = NF.instantiate(generalized, extendedCtx);

			expect({
				generalized: NF.display(generalized, extendedCtx),
				instantiated: NF.display(instantiated, extendedCtx),
			}).toMatchSnapshot();
		});

		it("generalizes a function type and instantiates it", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };

			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const piType = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(ctx, meta2));

			const [generalized, z] = NF.generalize(piType, ctx);
			const extendedCtx = { ...ctx, zonker: z };
			const instantiated = NF.instantiate(generalized, extendedCtx);

			expect({
				generalized: NF.display(generalized, extendedCtx),
				instantiated: NF.display(instantiated, extendedCtx),
			}).toMatchSnapshot();
		});
	});
});
