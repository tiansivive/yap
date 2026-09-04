import { describe, it, expect } from "vitest";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
import { mkCtx, runEB, runNF, shown } from "../../inference/__tests__/util";

import * as F from "fp-ts/function";

const seed = (...entries: Array<[number, NF.Value, number?]>): Metas.Registry =>
	entries.reduce((reg, [val, annotation, lvl = 0]) => Metas.register(reg, { meta: EB.Constructors.Vars.Meta(val, lvl), annotation }), Metas.empty);

/** Runs an elaboration program that must not abort; answers with the final registry. */
const run = <A>(ctx: EB.Context, registry: Metas.Registry, program: () => M.Elaboration<A>): [A, Metas.Registry] => {
	const { answer, registry: final } = runEB(ctx, program, registry);
	if (Eff.failed(answer)) {
		throw new Error("unexpected abort in generalization test");
	}
	return [answer, final];
};

describe("Normalization: generalization", () => {
	const noMetasTerm = EB.Constructors.Lit(Lit.Atom("Unit"));
	const noResolutions = {};

	describe("generalize", () => {
		it("simple meta: ?1 |=> Π(a: Type) => a", () => {
			const ctx = mkCtx();
			const meta = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });

			const [[generalized], registry] = run(ctx, seed([1, NF.Type]), () => NF.generalize(meta, noMetasTerm, noResolutions));
			const disp = shown(ctx, registry);

			// Should be wrapped in an implicit Pi
			const nf = disp(() => NF.display(generalized));
			expect(nf).toContain("=>");

			const quoted = runNF(ctx, () => NF.quote(ctx.env.length, generalized), registry);
			expect({
				nf,
				eb: disp(() => EB.Display.Term(quoted)),
			}).toMatchSnapshot();

			// The registry should have a solution for the meta
			expect(Metas.solution(registry, 1)).toBeDefined();
		});

		it("multiple metas: ?1 ?2 |=> Π(a: Type) => Π(b: Type) => a b", () => {
			const ctx = mkCtx();

			// Create Pi type: ?1 -> ?2
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const piType = NF.Constructors.App(meta1, meta2, "Explicit");

			const [[generalized], registry] = run(ctx, seed([1, NF.Type], [2, NF.Type]), () => NF.generalize(piType, noMetasTerm, noResolutions));
			const disp = shown(ctx, registry);

			// Should be double-wrapped in implicit Pis
			const nf = disp(() => NF.display(generalized));
			const matches = nf.match(/=>/g) || [];
			expect(matches.length).toBe(2);

			const quoted = runNF(ctx, () => NF.quote(0, generalized), registry);
			expect({
				nf,
				eb: disp(() => EB.Display.Term(quoted)),
			}).toMatchSnapshot();

			// Both metas should be solved
			expect(Metas.solution(registry, 1)).toBeDefined();
			expect(Metas.solution(registry, 2)).toBeDefined();
		});

		it("metas only in the term, not the type", () => {
			const ctx = mkCtx();

			// Type has no metas
			const typeWithNoMetas = NF.Constructors.Lit(Lit.Atom("Num"));
			// Term has ?1
			const termWithMeta = EB.Constructors.Var({ type: "Meta", val: 1, lvl: 0 });

			const [[generalized], registry] = run(ctx, seed([1, NF.Type]), () => NF.generalize(typeWithNoMetas, termWithMeta, noResolutions));

			// Even though type has no metas, ?1 in the term should be generalized
			const nf = shown(ctx, registry)(() => NF.display(generalized));
			expect(nf).toContain("(a: Type) =>");
			expect(nf).toContain("Num");

			expect({ nf }).toMatchSnapshot();

			expect(Metas.solution(registry, 1)).toBeDefined();
		});

		it("generalizes metas in both type and term, eliminating duplicates", () => {
			const ctx = mkCtx();

			// Type has ?1
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const typeWithMeta = meta1;

			// Term has ?1 (same as type) and ?2 and ?3
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const meta3 = EB.Constructors.Var({ type: "Meta", val: 3, lvl: 0 });
			const app1 = EB.Constructors.App("Explicit", meta2, meta3);
			const termWithMetas = app1;

			const [[generalized], registry] = run(ctx, seed([1, NF.Type], [2, NF.Type], [3, NF.Type]), () =>
				NF.generalize(typeWithMeta, termWithMetas, noResolutions),
			);

			const nf = shown(ctx, registry)(() => NF.display(generalized));
			// Should have three Pis (for ?1, ?2, ?3), not four
			// even though ?1 appears in both type and term
			const piMatches = nf.match(/=>/g) || [];
			expect(piMatches.length).toBe(3);

			expect({ nf }).toMatchSnapshot();

			expect(Metas.solution(registry, 1)).toBeDefined();
			expect(Metas.solution(registry, 2)).toBeDefined();
			expect(Metas.solution(registry, 3)).toBeDefined();
		});

		it("uses alphabetic variable names (a, b, c...): ?1 ?2 ?3 |=> Π(a: Type) => Π(b: Type) => Π(c: Type) => a b c", () => {
			const ctx = mkCtx();

			// Create a term with all three metas
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const meta3 = NF.Constructors.Flex({ type: "Meta", val: 3, lvl: 0 });

			// ?1 ?2 ?3
			const app1 = NF.Constructors.App(meta1, meta2, "Explicit");
			const app2 = NF.Constructors.App(app1, meta3, "Explicit");

			const [[generalized], registry] = run(ctx, seed([1, NF.Type], [2, NF.Type], [3, NF.Type]), () => NF.generalize(app2, noMetasTerm, noResolutions));
			const disp = shown(ctx, registry);
			const display = disp(() => NF.display(generalized));

			// Should contain variable names a, b, c
			expect(display).toContain("a");
			expect(display).toContain("b");
			expect(display).toContain("c");

			const quoted = runNF(ctx, () => NF.quote(0, generalized), registry);
			expect({ nf: display, eb: disp(() => EB.Display.Term(quoted)) }).toMatchSnapshot();
		});

		it("uses 'r' prefix for Row variables: ?1 ?2 |=> Π(r: Row) => Π(a: Type) => r → a", () => {
			const ctx = mkCtx();

			// Create metas: one Row, one Type
			const metaRow = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const metaType = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });

			const [[generalized], registry] = run(ctx, seed([1, NF.Row], [2, NF.Type]), () =>
				NF.generalize(NF.Constructors.App(metaRow, metaType, "Explicit"), noMetasTerm, noResolutions),
			);
			const display = shown(ctx, registry)(() => NF.display(generalized));

			// Should contain 'r' for Row variable and 'a' for Type variable
			expect(display).toContain("r");
			expect(display).toContain("a");

			expect({ nf: display }).toMatchSnapshot();
		});

		it("sequences type and row variables correctly: ?1 ?2 ?3 |=> Π(a: Type) => Π(b: Type) => Π(r: Row) => ...", () => {
			const ctx = mkCtx();

			// Type with all three metas
			const m1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const m2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const m3 = NF.Constructors.Flex({ type: "Meta", val: 3, lvl: 0 });

			const app1 = NF.Constructors.App(m1, m2, "Explicit");
			const app2 = NF.Constructors.App(app1, m3, "Explicit");

			const [[generalized], registry] = run(ctx, seed([1, NF.Type], [2, NF.Type], [3, NF.Row]), () => NF.generalize(app2, noMetasTerm, noResolutions));
			const display = shown(ctx, registry)(() => NF.display(generalized));

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
			// We'll create the first meta with a Pi value annotation
			const typeCtor = NF.Constructors.Pi("x", "Implicit", NF.Type, NF.Constructors.Closure(ctx, EB.Type));

			// Type with both metas
			const metaTypeCtor = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });

			const [[generalized], registry] = run(ctx, seed([1, typeCtor]), () => NF.generalize(metaTypeCtor, noMetasTerm, noResolutions));
			const display = shown(ctx, registry)(() => NF.display(generalized));

			// Should contain 'F' for TypeCtor variable and 'a' for Type variable
			expect(display).toContain("F");
			// Verify it's a type constructor (should have arrow)
			expect(display).toContain("Type");

			expect({ nf: display }).toMatchSnapshot();
		});

		it("handles pi types: ?1 -> ?2 -> ?3 |=> Π(a: Type) => Π(b: Type) => Π(c: Type) => Π(x: a) -> Π(y: b) -> c", () => {
			const ctx = mkCtx();

			// Create a term with all three metas
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const meta3 = EB.Constructors.Var({ type: "Meta", val: 3, lvl: 0 });

			// ?1 -> ?2 -> ?3
			const inner = EB.Constructors.Pi("y", "Explicit", meta2, meta3);
			const outer = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(ctx, inner));

			const [[generalized], registry] = run(ctx, seed([1, NF.Type], [2, NF.Type], [3, NF.Type]), () => NF.generalize(outer, noMetasTerm, noResolutions));
			const disp = shown(ctx, registry);

			const display = disp(() => NF.display(generalized));
			const quoted = runNF(ctx, () => NF.quote(0, generalized), registry);
			expect({ nf: display, eb: disp(() => EB.Display.Term(quoted)) }).toMatchSnapshot();
		});

		it("correctly types metas: (?1:Type) -> (?2: Row)  |=> Π(a: Type) => Π(r: Row) => Π(x: a) -> r", () => {
			const ctx = mkCtx();

			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const piType = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(ctx, meta2));

			const [[generalized], registry] = run(ctx, seed([1, NF.Type], [2, NF.Row]), () => NF.generalize(piType, noMetasTerm, noResolutions));
			const disp = shown(ctx, registry);

			const nf = disp(() => NF.display(generalized));
			expect(nf).toContain("a: Type");
			expect(nf).toContain("r: Row");

			const quoted = runNF(ctx, () => NF.quote(0, generalized), registry);
			expect({
				nf,
				eb: disp(() => EB.Display.Term(quoted)),
			}).toMatchSnapshot();
		});

		it("preserves already-solved metas", () => {
			const ctx = mkCtx();
			const seeded = Metas.solve(seed([1, NF.Type], [2, NF.Type]), 2, NF.Constructors.Lit(Lit.Atom("Num")));

			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const piType = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(ctx, meta2));

			const [[generalized], registry] = run(ctx, seeded, () => NF.generalize(piType, noMetasTerm, noResolutions));
			const disp = shown(ctx, registry);

			// Only ?1 should be generalized
			const nf = disp(() => NF.display(generalized));
			expect(nf).toContain("a: Type");
			expect(nf).toContain("-> Num");

			const quoted = runNF(ctx, () => NF.quote(0, generalized), registry);
			expect({
				nf,
				eb: disp(() => EB.Display.Term(quoted)),
			}).toMatchSnapshot();

			// Original solution should be preserved
			expect(Metas.solution(registry, 2)).toBeDefined();
		});

		it("ignores metas that are in the resolutions parameter", () => {
			const ctx = mkCtx();

			// Both metas in the type
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const typeWithMetas = NF.Constructors.App(meta1, meta2, "Explicit");

			// ?2 is in resolutions (resolved implicitly), so it should not be generalized
			const resolutions: EB.Resolutions = { 2: NF.Constructors.Lit(Lit.Atom("Num")) };

			/* Solve committed ?2 to the registry before handing the same fact over as a resolution. */
			const seeded = Metas.solve(seed([1, NF.Type], [2, NF.Type]), 2, resolutions[2]);

			const [[generalized], registry] = run(ctx, seeded, () => NF.generalize(typeWithMetas, noMetasTerm, resolutions));

			const nf = shown(ctx, registry)(() => NF.display(generalized));
			// Should only have one Pi for ?1, not two
			const piMatches = nf.match(/=>/g) || [];
			expect(piMatches.length).toBe(1);

			expect({ nf }).toMatchSnapshot();
		});

		it("ignores resolved metas in both type and term", () => {
			const ctx = mkCtx();

			// Type has ?1 and ?2
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 });
			const typeWithMetas = NF.Constructors.App(meta1, meta2, "Explicit");

			// Term has ?2 (resolved) and ?3
			const meta2EB = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const meta3 = EB.Constructors.Var({ type: "Meta", val: 3, lvl: 0 });
			const termWithMetas = EB.Constructors.App("Explicit", meta2EB, meta3);

			// ?2 is resolved
			const resolutions: EB.Resolutions = { 2: NF.Constructors.Lit(Lit.Atom("Num")) };

			const seeded = Metas.solve(seed([1, NF.Type], [2, NF.Type], [3, NF.Type]), 2, resolutions[2]);

			const [[generalized], registry] = run(ctx, seeded, () => NF.generalize(typeWithMetas, termWithMetas, resolutions));

			const nf = shown(ctx, registry)(() => NF.display(generalized));
			// Should have two Pis: for ?1 and ?3 (not ?2, which is resolved)
			const piMatches = nf.match(/=>/g) || [];
			expect(piMatches.length).toBe(2);

			expect({ nf }).toMatchSnapshot();
		});

		it("returns the value unchanged when there are no metas to generalize", () => {
			const ctx = mkCtx();
			const numType = NF.Constructors.Lit(Lit.Atom("Num"));

			const [[generalized], registry] = run(ctx, Metas.empty, () => NF.generalize(numType, noMetasTerm, noResolutions));

			// Should be unchanged
			expect(generalized).toBe(numType);
			expect(registry).toStrictEqual(Metas.empty);

			expect({ nf: shown(ctx, registry)(() => NF.display(generalized)) }).toMatchSnapshot();
		});

		it("introduces binder under existing environment entries", () => {
			const ctx = mkCtx();
			const xtended = EB.bind(ctx, { type: "Let", variable: "x" }, NF.Any);

			/* Minted under the binding, so the scope filter keeps it: this is the meta of the declaration being generalized. */
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 1 });
			const [[generalized], registry] = run(xtended, seed([1, NF.Type, 1]), () => NF.generalize(meta1, noMetasTerm, noResolutions));
			const disp = shown(xtended, registry);

			const quoted = runNF(xtended, () => NF.quote(xtended.env.length, generalized), registry);

			expect({ nf: disp(() => NF.display(generalized)), eb: disp(() => EB.Display.Term(quoted)) }).toMatchSnapshot();
		});

		it("introduces multiple binders under existing environment entries", () => {
			const ctx = mkCtx();
			const xtended = F.pipe(
				ctx,
				ctx => EB.bind(ctx, { type: "Let", variable: "x" }, NF.Any),
				ctx => EB.bind(ctx, { type: "Let", variable: "y" }, NF.Any),
			);

			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 2 });
			const meta2 = NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 2 });
			const app = NF.Constructors.App(meta1, meta2, "Explicit");

			const [[generalized], registry] = run(xtended, seed([1, NF.Type, 2], [2, NF.Type, 2]), () => NF.generalize(app, noMetasTerm, noResolutions));
			const disp = shown(xtended, registry);

			// The inserted binders sit after the existing env, not on top of x and y
			expect(Metas.solution(registry, 1)).toMatchObject({ variable: { type: "Bound", lvl: 2 } });
			expect(Metas.solution(registry, 2)).toMatchObject({ variable: { type: "Bound", lvl: 3 } });

			const quoted = runNF(xtended, () => NF.quote(xtended.env.length, generalized), registry);

			expect({ nf: disp(() => NF.display(generalized)), eb: disp(() => EB.Display.Term(quoted)) }).toMatchSnapshot();
		});

		it("handles pi types under existing environment entries", () => {
			const ctx = mkCtx();

			const xtended = F.pipe(
				ctx,
				ctx => EB.bind(ctx, { type: "Let", variable: "one" }, NF.Any),
				ctx => EB.bind(ctx, { type: "Let", variable: "two" }, NF.Any),
			);

			// Create a term with both metas
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 2 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 2 });

			// ?1 -> ?2
			const pi = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(xtended, meta2));
			const [[generalized], registry] = run(xtended, seed([1, NF.Type, 2], [2, NF.Type, 2]), () => NF.generalize(pi, noMetasTerm, noResolutions));
			const disp = shown(xtended, registry);

			const quoted = runNF(xtended, () => NF.quote(xtended.env.length, generalized), registry);
			expect({ nf: disp(() => NF.display(generalized)), eb: disp(() => EB.Display.Term(quoted)) }).toMatchSnapshot();
		});

		it("leaves metas from outer scopes alone", () => {
			const xtended = F.pipe(
				mkCtx(),
				ctx => EB.bind(ctx, { type: "Let", variable: "x" }, NF.Any),
				ctx => EB.bind(ctx, { type: "Let", variable: "y" }, NF.Any),
			);

			/* Minted before either binding, so they belong to an enclosing scope and are that scope's to generalize. */
			const app = NF.Constructors.App(
				NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 }),
				NF.Constructors.Flex({ type: "Meta", val: 2, lvl: 0 }),
				"Explicit",
			);

			const [[generalized, quantified], registry] = run(xtended, seed([1, NF.Type], [2, NF.Type]), () => NF.generalize(app, noMetasTerm, noResolutions));

			expect(quantified).toBe(false);
			expect(generalized).toBe(app);
			expect(Metas.solution(registry, 1)).toBeUndefined();
			expect(Metas.solution(registry, 2)).toBeUndefined();

			expect({ nf: shown(xtended, registry)(() => NF.display(generalized)) }).toMatchSnapshot();
		});
	});

	describe("instantiate", () => {
		it("instantiates unconstrained Type meta to Any", () => {
			const ctx = mkCtx();
			const meta = NF.Constructors.Var({ type: "Meta", val: 1, lvl: 0 });

			const [instantiated, registry] = run(ctx, seed([1, NF.Type]), () => NF.instantiate(meta));
			const nf = shown(ctx, registry)(() => NF.display(instantiated));
			expect(nf).toBe("Any");

			expect({ nf }).toMatchSnapshot();
		});

		it("instantiates unconstrained Row meta to empty row", () => {
			const ctx = mkCtx();
			const meta = NF.Constructors.Var({ type: "Meta", val: 1, lvl: 0 });

			const [instantiated, registry] = run(ctx, seed([1, NF.Row]), () => NF.instantiate(meta));
			const nf = shown(ctx, registry)(() => NF.display(instantiated));
			expect(nf).toBe("[]");

			expect({ nf }).toMatchSnapshot();
		});

		it("leaves solved metas unchanged", () => {
			const ctx = mkCtx();
			const seeded = Metas.solve(seed([1, NF.Type]), 1, NF.Constructors.Lit(Lit.Atom("Num")));

			const meta = NF.Constructors.Var({ type: "Meta", val: 1, lvl: 0 });

			const [instantiated, registry] = run(ctx, seeded, () => NF.instantiate(meta));
			const nf = shown(ctx, registry)(() => NF.display(instantiated));
			expect(nf).toBe("Num");

			expect({ nf }).toMatchSnapshot();
		});

		it("leaves non-meta values unchanged", () => {
			const ctx = mkCtx();
			const numLit = NF.Constructors.Lit(Lit.Num(42));

			const [instantiated, registry] = run(ctx, Metas.empty, () => NF.instantiate(numLit));

			expect({ nf: shown(ctx, registry)(() => NF.display(instantiated)) }).toMatchSnapshot();
		});

		it("leaves bound variables unchanged", () => {
			const ctx = mkCtx();
			const boundVar = NF.Constructors.Var({ type: "Bound", lvl: 0 });

			const [instantiated, registry] = run(ctx, Metas.empty, () => NF.instantiate(boundVar));

			expect({ nf: shown(ctx, registry)(() => NF.display(instantiated)) }).toMatchSnapshot();
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

			expect({ nf: shown(ctx, Metas.empty)(() => NF.display(trimmed)) }).toMatchSnapshot();
		});
	});

	describe("integration: generalize + instantiate round-trip", () => {
		it("generalizes and then instantiates a polymorphic type", () => {
			const ctx = mkCtx();
			const meta = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });

			const [[generalized, instantiated], registry] = run(ctx, seed([1, NF.Type]), function* () {
				const [g] = yield* NF.generalize(meta, noMetasTerm, noResolutions);
				return [g, yield* NF.instantiate(g)] as const;
			});
			const disp = shown(ctx, registry);

			expect({
				generalized: disp(() => NF.display(generalized)),
				instantiated: disp(() => NF.display(instantiated)),
			}).toMatchSnapshot();
		});

		it("generalizes a function type and instantiates it", () => {
			const ctx = mkCtx();

			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });
			const piType = NF.Constructors.Pi("x", "Explicit", meta1, NF.Constructors.Closure(ctx, meta2));

			const [[generalized, instantiated], registry] = run(ctx, seed([1, NF.Type], [2, NF.Type]), function* () {
				const [g] = yield* NF.generalize(piType, noMetasTerm, noResolutions);
				return [g, yield* NF.instantiate(g)] as const;
			});
			const disp = shown(ctx, registry);

			expect({
				generalized: disp(() => NF.display(generalized)),
				instantiated: disp(() => NF.display(instantiated)),
			}).toMatchSnapshot();
		});

		it("generalizes metas in term and type, then instantiates", () => {
			const ctx = mkCtx();

			// Type has ?1
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });

			// Term has ?2
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });

			const [[generalized, instantiated], registry] = run(ctx, seed([1, NF.Type], [2, NF.Type]), function* () {
				const [g] = yield* NF.generalize(meta1, meta2, noResolutions);
				return [g, yield* NF.instantiate(g)] as const;
			});
			const disp = shown(ctx, registry);

			expect({
				generalized: disp(() => NF.display(generalized)),
				instantiated: disp(() => NF.display(instantiated)),
			}).toMatchSnapshot();
		});

		it("generalizes with resolutions and then instantiates", () => {
			const ctx = mkCtx();

			// Type has ?1
			const meta1 = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
			// Term has ?2
			const meta2 = EB.Constructors.Var({ type: "Meta", val: 2, lvl: 0 });

			const resolutions: EB.Resolutions = { 2: NF.Constructors.Lit(Lit.Atom("Num")) };

			const [[generalized, instantiated], registry] = run(ctx, seed([1, NF.Type], [2, NF.Type]), function* () {
				const [g] = yield* NF.generalize(meta1, meta2, resolutions);
				return [g, yield* NF.instantiate(g)] as const;
			});
			const disp = shown(ctx, registry);

			expect({
				generalized: disp(() => NF.display(generalized)),
				instantiated: disp(() => NF.display(instantiated)),
			}).toMatchSnapshot();
		});
	});
});
