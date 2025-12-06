import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { mkCtx } from "../../inference/__tests__/util";

import * as F from "fp-ts/function";

describe("Normalization: generalization", () => {
	const noMetasTerm = EB.Constructors.Lit(Lit.Atom("Unit"));
	const noResolutions = {};
	describe("generalize", () => {
		it("simple meta: ?1 |=> Π(a: Type) => a", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };

			const meta = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const [generalized, z] = NF.generalize(meta, noMetasTerm, ctx, noResolutions);
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

			const [generalized, z] = NF.generalize(piType, noMetasTerm, ctx, noResolutions);
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

		it("metas only in the term, not the type", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };

			// Type has no metas
			const typeWithNoMetas = NF.Constructors.Lit(Lit.Atom("Num"));
			// Term has ?1
			const termWithMeta = EB.Constructors.Var({ type: "Meta", val: 1, lvl: 0 });

			const [generalized, z] = NF.generalize(typeWithNoMetas, termWithMeta, ctx, noResolutions);
			const extendedCtx = { ...ctx, zonker: z };

			// Even though type has no metas, ?1 in the term should be generalized
			const nf = NF.display(generalized, extendedCtx);
			expect(nf).toContain("(a: Type) =>");
			expect(nf).toContain("Num");

			expect({ nf }).toMatchSnapshot();

			expect(extendedCtx.zonker[1]).toBeDefined();
		});

		it("generalizes metas in both type and term, eliminating duplicates", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };
			ctx.metas[3] = { meta: EB.Constructors.Vars.Meta(3, 0), ann: NF.Type };

			// Type has ?1
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const typeWithMeta = meta1;

			// Term has ?1 (same as type) and ?2 and ?3
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const meta3 = EB.Constructors.Var({ type: "Meta", val: 3, lvl: 0 });
			const app1 = EB.Constructors.App("Explicit", meta2, meta3);
			const termWithMetas = app1;

			const [generalized, z] = NF.generalize(typeWithMeta, termWithMetas, ctx, noResolutions);
			const extendedCtx = { ...ctx, zonker: z };

			const nf = NF.display(generalized, extendedCtx);
			// Should have three Pis (for ?1, ?2, ?3), not four
			// even though ?1 appears in both type and term
			const piMatches = nf.match(/=>/g) || [];
			expect(piMatches.length).toBe(3);

			expect({ nf }).toMatchSnapshot();

			expect(extendedCtx.zonker[1]).toBeDefined();
			expect(extendedCtx.zonker[2]).toBeDefined();
			expect(extendedCtx.zonker[3]).toBeDefined();
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

			const [generalized, z] = NF.generalize(app2, noMetasTerm, ctx, noResolutions);
			const extendedCtx = { ...ctx, zonker: z };
			const display = NF.display(generalized, extendedCtx);

			// Should contain variable names a, b, c
			expect(display).toContain("a");
			expect(display).toContain("b");
			expect(display).toContain("c");

			const quoted = NF.quote(extendedCtx, 0, generalized);
			expect({ nf: display, eb: EB.Display.Term(quoted, extendedCtx) }).toMatchSnapshot();
		});

		it("uses 'r' prefix for Row variables: ?1 ?2 |=> Π(r: Row) => Π(a: Type) => r → a", () => {
			const ctx = mkCtx();

			// Create metas: one Row, one Type
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Row };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };

			// Type with both metas
			const metaRow = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const metaType = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });

			const [generalized, z] = NF.generalize(NF.Constructors.App(metaRow, metaType, "Explicit"), noMetasTerm, ctx, noResolutions);
			const extendedCtx = { ...ctx, zonker: z };
			const display = NF.display(generalized, extendedCtx);

			// Should contain 'r' for Row variable and 'a' for Type variable
			expect(display).toContain("r");
			expect(display).toContain("a");

			expect({ nf: display }).toMatchSnapshot();
		});

		it("sequences type and row variables correctly: ?1 ?2 ?3 |=> Π(a: Type) => Π(b: Type) => Π(r: Row) => ...", () => {
			const ctx = mkCtx();

			// Create metas: two Types and one Row
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };
			ctx.metas[3] = { meta: EB.Constructors.Vars.Meta(3, 0), ann: NF.Row };

			// Type with all three metas
			const m1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const m2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const m3 = NF.Constructors.Flex({ type: "Meta", val: 3, lvl: 0 });

			const app1 = NF.Constructors.App(m1, m2, "Explicit");
			const app2 = NF.Constructors.App(app1, m3, "Explicit");

			const [generalized, z] = NF.generalize(app2, noMetasTerm, ctx, noResolutions);
			const extendedCtx = { ...ctx, zonker: z };
			const display = NF.display(generalized, extendedCtx);

			// Should have a, b for Type variables and r for Row
			expect(display).toContain("a");
			expect(display).toContain("b");
			expect(display).toContain("r");

			// Verify ordering: type variables (a, b) should appear before row variable (r)
			const aIdx = display.indexOf("a: Type");
			const bIdx = display.indexOf("b: Type");
			const rIdx = display.indexOf("r: Row");
			expect(aIdx).toBeLessThan(rIdx);
			expect(bIdx).toBeLessThan(rIdx);

			expect({ nf: display }).toMatchSnapshot();
		});

		it("uses 'F' prefix for Type Constructor (Type -> Type) metas: ?1 ?2 |=> Π(F: Type -> Type) => Π(a: Type) => F a", () => {
			const ctx = mkCtx();

			// Create metas: one Type constructor (Type -> Type), one regular Type
			// We'll create the first meta with a Pi type annotation
			const typeToType = NF.Constructors.Pi("x", "Implicit", NF.Type, NF.Constructors.Closure(ctx, EB.Constructors.Lit(Lit.Type())));
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: typeToType };

			// Type with both metas
			const metaTypeCtor = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });

			const [generalized, z] = NF.generalize(metaTypeCtor, noMetasTerm, ctx, noResolutions);
			const extendedCtx = { ...ctx, zonker: z };
			const display = NF.display(generalized, extendedCtx);

			// Should contain 'F' for TypeCtor variable and 'a' for Type variable
			expect(display).toContain("F");
			// Verify it's a type constructor (should have arrow)
			expect(display).toContain("Type");

			expect({ nf: display }).toMatchSnapshot();
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

			const [generalized, z] = NF.generalize(outer, noMetasTerm, ctx, noResolutions);
			const extendedCtx = { ...ctx, zonker: z };

			const display = NF.display(generalized, extendedCtx);
			const quoted = NF.quote(extendedCtx, 0, generalized);
			expect({ nf: display, eb: EB.Display.Term(quoted, extendedCtx) }).toMatchSnapshot();
		});

		it("correctly types metas: (?1:Type) -> (?2: Row)  |=> Π(a: Type) => Π(r: Row) => Π(x: a) -> r", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Row };

			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const piType = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(ctx, meta2));

			const [generalized, z] = NF.generalize(piType, noMetasTerm, ctx, noResolutions);
			const extendedCtx = { ...ctx, zonker: z };

			const nf = NF.display(generalized, extendedCtx);
			expect(nf).toContain("a: Type");
			expect(nf).toContain("r: Row");

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

			const [generalized, z] = NF.generalize(piType, noMetasTerm, ctx, noResolutions);
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

		it("ignores metas that are in the resolutions parameter", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };

			// Both metas in the type
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const typeWithMetas = NF.Constructors.App(meta1, meta2, "Explicit");

			// ?2 is in resolutions (resolved implicitly), so it should not be generalized
			const resolutions: EB.Resolutions = { 2: EB.Constructors.Lit(Lit.Atom("Num")) };

			const [generalized, z] = NF.generalize(typeWithMetas, noMetasTerm, ctx, resolutions);
			const extendedCtx = { ...ctx, zonker: z };

			const nf = NF.display(generalized, extendedCtx);
			// Should only have one Pi for ?1, not two
			const piMatches = nf.match(/=>/g) || [];
			expect(piMatches.length).toBe(1);

			expect({ nf }).toMatchSnapshot();
		});

		it("ignores resolved metas in both type and term", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };
			ctx.metas[3] = { meta: EB.Constructors.Vars.Meta(3, 0), ann: NF.Type };

			// Type has ?1 and ?2
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const typeWithMetas = NF.Constructors.App(meta1, meta2, "Explicit");

			// Term has ?2 (resolved) and ?3
			const meta2EB = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const meta3 = EB.Constructors.Var({ type: "Meta", val: 3, lvl: 0 });
			const termWithMetas = EB.Constructors.App("Explicit", meta2EB, meta3);

			// ?2 is resolved
			const resolutions: EB.Resolutions = { 2: EB.Constructors.Lit(Lit.Atom("Num")) };

			const [generalized, z] = NF.generalize(typeWithMetas, termWithMetas, ctx, resolutions);
			const extendedCtx = { ...ctx, zonker: z };

			const nf = NF.display(generalized, extendedCtx);
			// Should have two Pis: for ?1 and ?3 (not ?2, which is resolved)
			const piMatches = nf.match(/=>/g) || [];
			expect(piMatches.length).toBe(2);

			expect({ nf }).toMatchSnapshot();
		});

		it("returns the value unchanged when there are no metas to generalize", () => {
			const ctx = mkCtx();
			const numType = NF.Constructors.Lit(Lit.Atom("Num"));

			const [generalized, z] = NF.generalize(numType, noMetasTerm, ctx, noResolutions);
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
			const [generalized, z] = NF.generalize(meta1, noMetasTerm, xtended, noResolutions);
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

			const [generalized, z] = NF.generalize(app, noMetasTerm, xtended, noResolutions);
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
			const [generalized, z] = NF.generalize(pi, noMetasTerm, xtended, noResolutions);
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

			const [generalized, z] = NF.generalize(meta, noMetasTerm, ctx, noResolutions);
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

			const [generalized, z] = NF.generalize(piType, noMetasTerm, ctx, noResolutions);
			const extendedCtx = { ...ctx, zonker: z };
			const instantiated = NF.instantiate(generalized, extendedCtx);

			expect({
				generalized: NF.display(generalized, extendedCtx),
				instantiated: NF.display(instantiated, extendedCtx),
			}).toMatchSnapshot();
		});

		it("generalizes metas in term and type, then instantiates", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };

			// Type has ?1
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });

			// Term has ?2
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });

			const [generalized, z] = NF.generalize(meta1, meta2, ctx, noResolutions);
			const extendedCtx = { ...ctx, zonker: z };
			const instantiated = NF.instantiate(generalized, extendedCtx);

			expect({
				generalized: NF.display(generalized, extendedCtx),
				instantiated: NF.display(instantiated, extendedCtx),
			}).toMatchSnapshot();
		});

		it("generalizes with resolutions and then instantiates", () => {
			const ctx = mkCtx();
			ctx.metas[1] = { meta: EB.Constructors.Vars.Meta(1, 0), ann: NF.Type };
			ctx.metas[2] = { meta: EB.Constructors.Vars.Meta(2, 0), ann: NF.Type };

			// Type has ?1
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			// Term has ?2
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });

			const resolutions: EB.Resolutions = { 2: EB.Constructors.Lit(Lit.Atom("Num")) };

			const [generalized, z] = NF.generalize(meta1, meta2, ctx, resolutions);
			const extendedCtx = { ...ctx, zonker: z };
			const instantiated = NF.instantiate(generalized, extendedCtx);

			expect({
				generalized: NF.display(generalized, extendedCtx),
				instantiated: NF.display(instantiated, extendedCtx),
			}).toMatchSnapshot();
		});
	});
});
