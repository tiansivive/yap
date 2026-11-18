import assert from "node:assert";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as U from "@yap/elaboration/unification";
import * as Sub from "@yap/elaboration/unification/substitution";
import * as Eff from "@yap/utils/effects";
import { elaborateFrom, mkCtx, parseExpr, runEB, runNF } from "../inference/__tests__/util";

const C = EB.Constructors;
const V = NF.Constructors;
const D = EB.DSL;
const modes = ["Psi", "Phi"] as const;
const predicateType = C.Pi("s", "Explicit", EB.State, D.type("Bool"));
const argument = (mode: (typeof modes)[number]) => (mode === "Psi" ? C.Var(C.Vars.Foreign("state")) : EB.Unrestricted);
const binder = (mode: (typeof modes)[number], body: EB.Term) => (mode === "Psi" ? C.Psi("s", EB.Unrestricted, body) : C.Phi("P", predicateType, body));

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("contextual core", () => {
	it.each(modes)("substitutes the ordinary bound reference in a %s binder", mode => {
		const term = C.App(mode, binder(mode, C.Var(EB.Bound(0))), argument(mode));
		const value = runNF(mkCtx(), () => NF.normalize(term));
		expect(runNF(mkCtx(), () => NF.view(value)).value).toMatchObject(
			mode === "Psi"
				? { type: "Var", variable: { name: "state" } }
				: { type: "Abs", binder: { type: "Lambda" }, closure: { term: { type: "Lit", value: { value: true } } } },
		);
	});

	it.each(modes)("preserves an unknown %s application through block readback", mode => {
		const term = C.App(mode, C.Var(C.Vars.Foreign("f")), argument(mode));
		const quoted = runNF(mkCtx(), function* () {
			return yield* NF.quote(0, yield* NF.normalize(C.Block([], term)));
		});
		expect(quoted).toMatchObject({
			type: "App",
			icit: mode,
			func: { type: "Var", variable: { name: "f" } },
			arg: mode === "Psi" ? { type: "Var", variable: { name: "state" } } : { type: "Abs", binding: { type: "Lambda" } },
		});
	});

	it.each(modes)("quotes a %s binder with ordinary de Bruijn indices", mode => {
		const quoted = runNF(mkCtx(), function* () {
			return yield* NF.quote(0, yield* NF.normalize(binder(mode, C.Var(EB.Bound(0)))));
		});
		expect(quoted).toMatchObject({ type: "Abs", binding: { type: mode }, body: { type: "Var", variable: { type: "Bound", index: 0 } } });
	});

	it.each(modes)("compares %s contracts through their bodies", mode => {
		const result = runEB(mkCtx(), function* () {
			const left = yield* NF.normalize(binder(mode, D.type("Num")));
			const right = yield* NF.normalize(binder(mode, D.type("Num")));
			const [, subst] = yield* Eff.with([Sub.subst.handlers()], () => U.unify(left, right, 0));
			return subst;
		});
		assert(!Eff.failed(result.answer));
		expect(Sub.isEmpty(result.answer)).toBe(true);
	});

	it.each(modes)("rejects differing result types under %s contracts", mode => {
		const result = runEB(mkCtx(), function* () {
			const left = yield* NF.normalize(binder(mode, D.type("Num")));
			const right = yield* NF.normalize(binder(mode, D.type("String")));
			return yield* Eff.with([Sub.subst.handlers()], () => U.unify(left, right, 0));
		});
		expect(Eff.failed(result.answer)).toBe(true);
	});

	it("introduces a call-state binder before a source arrow's parameter", () => {
		const result = elaborateFrom("(x: Num) -> Num");
		expect(result.structure.term).toMatchObject({ type: "Abs", binding: { type: "Psi" }, body: { type: "Abs", binding: { type: "Pi", icit: "Explicit" } } });
	});

	it("keeps an uncalled source function polymorphic in its call state", () => {
		const result = elaborateFrom("{ return \\(x: Num) -> x; }");
		expect(runNF(mkCtx(), () => NF.view(result.structure.type), result.registry)).toMatchObject({ value: { type: "Abs", binder: { type: "Psi" } } });
		expect(Object.values(result.registry).filter(entry => entry.kind === "State")).toHaveLength(0);
	});

	it("instantiates predicate references independently with verifier-owned metas", () => {
		const ctx = mkCtx();
		const type = runNF(ctx, () => NF.normalize(C.Phi("P", predicateType, D.type("Num"))));
		const input: EB.AST = [C.Var(C.Vars.Foreign("f")), type, []];
		const result = runEB(ctx, function* () {
			return [yield* EB.Icit.predicates(input), yield* EB.Icit.predicates(input)];
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer.map(([term]) => term)).toMatchObject([
			{ type: "App", icit: "Phi" },
			{ type: "App", icit: "Phi" },
		]);
		expect(Object.values(result.registry).map(entry => entry.kind)).toEqual(["Predicate", "Predicate"]);
	});

	it("collects the requirement and predicate annotation through both representations", () => {
		const result = runEB(mkCtx(), function* () {
			const requirement = yield* EB.freshMeta(0, yield* NF.normalize(predicateType), "Predicate");
			const annotation = yield* EB.freshMeta(1, NF.Type);
			const core = C.Psi("s", C.Var(requirement), C.Phi("P", C.Var(annotation), C.Var(EB.Bound(0))));
			const collect = yield* Metas.collectors();
			return { core: collect.eb(core), value: collect.nf(yield* NF.normalize(core)), metas: [requirement, annotation] };
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer.core).toEqual(result.answer.metas);
		expect(result.answer.value).toEqual(result.answer.metas);
	});
	it("preserves a callback's state application through source block-return elaboration", () => {
		const result = elaborateFrom("\\(f: Num -> Num) -> { return f 1; }");
		expect(result.structure.term).toMatchObject({
			binding: { type: "Psi" },
			body: { term: { binding: { type: "Lambda" }, body: { type: "Block", return: { type: "App", icit: "Explicit", func: { type: "App", icit: "Psi" } } } } },
		});
	});

	it("allocates a fresh state instance at each call", () => {
		const result = elaborateFrom("{ let id: Num -> Num = \\x -> x; let a = id 1; return id 2; }");
		const states = Object.values(result.registry).filter(entry => entry.kind === "State");
		expect(states).toHaveLength(2);
		expect(states.every(entry => entry.solution === undefined)).toBe(true);
	});

	it("preserves a returned function's state binder after partial application", () => {
		const result = elaborateFrom("{ let applyLater = \\f -> \\x -> f x; return applyLater (\\(n: Num) -> n); }");
		const value = runNF(mkCtx(), () => NF.normalize(result.structure.term), result.registry);
		expect(runNF(mkCtx(), () => NF.view(value), result.registry)).toMatchObject({ value: { type: "Abs", binder: { type: "Psi" } } });
		expect(runNF(mkCtx(), () => NF.view(result.structure.type), result.registry)).toMatchObject({ value: { type: "Abs", binder: { type: "Psi" } } });
	});

	it("preserves an outer predicate reference in a state requirement", () => {
		const ctx = EB.bind(
			mkCtx(),
			{ type: "Phi", variable: "P" },
			runNF(mkCtx(), () => NF.normalize(predicateType)),
		);
		const term = C.Psi("s", C.Var(EB.Bound(0)), C.Var(EB.Bound(0)));
		const quoted = runNF(ctx, function* () {
			return yield* NF.quote(1, yield* NF.normalize(term));
		});
		expect(quoted).toMatchObject({
			type: "Abs",
			binding: { type: "Psi", requirement: { type: "Var", variable: { index: 0 } } },
			body: { type: "Var", variable: { index: 0 } },
		});
	});

	it.each(modes)("retains %s elimination under a modal callee", mode => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const ctx = mkCtx();
		const value = runNF(ctx, function* () {
			const fn = yield* NF.normalize(binder(mode, C.Var(EB.Bound(0))));
			return yield* NF.reduce(V.Modal(fn, { quantity: "Many", liquid: yield* NF.normalize(EB.Unrestricted) }), yield* NF.normalize(argument(mode)), mode);
		});
		expect(runNF(ctx, () => NF.view(value)).value).toMatchObject(
			mode === "Psi" ? { type: "Var", variable: { name: "state" } } : { type: "Abs", binder: { type: "Lambda" } },
		);
		expect(warning).toHaveBeenCalledOnce();
		warning.mockRestore();
	});

	it("visits state requirements and predicate annotations during structural traversal", () => {
		const meta = EB.Meta(0, 0);
		const core = C.Psi("s", C.Var(meta), C.Phi("P", C.Var(meta), C.Var(meta)));
		const transformed = EB.traverse(core, () => D.type("Bool"));
		expect(transformed).toMatchObject({
			binding: { requirement: { value: { value: "Bool" } } },
			body: { binding: { annotation: { value: { value: "Bool" } } }, body: { value: { value: "Bool" } } },
		});
		const value = runNF(mkCtx(), () => NF.normalize(core));
		const mapped = NF.traverse(
			value,
			() => V.Atom("Bool"),
			term => EB.traverse(term, () => D.type("Bool")),
		);
		expect(mapped).toMatchObject({
			binder: { requirement: { value: { value: { value: "Bool" } } } },
			closure: { term: { binding: { annotation: { value: { value: "Bool" } } } } },
		});
	});

	it("substitutes a solved requirement while preserving an unsolved predicate instance", () => {
		const result = runEB(mkCtx(), function* () {
			const requirement = yield* EB.freshMeta(0, yield* NF.normalize(predicateType), "Predicate");
			const predicate = yield* EB.freshMeta(0, NF.Type, "Predicate");
			const truth = yield* NF.normalize(EB.Unrestricted);
			yield* Metas.registry.modify(registry => Metas.solve(registry, requirement.val, truth));
			const term = C.Psi("s", C.Var(requirement), C.Phi("P", C.Var(predicate), D.type("Num")));
			return { core: yield* EB.Icit.instantiate(term, {}), value: yield* NF.instantiate(yield* NF.normalize(term)), predicate };
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer.core).toMatchObject({
			binding: { requirement: { type: "Abs", binding: { type: "Lambda" }, body: { value: { value: true } } } },
			body: { binding: { annotation: { variable: result.answer.predicate } } },
		});
		expect(result.answer.value).toMatchObject({
			binder: { requirement: { type: "Abs", binder: { type: "Lambda" }, closure: { term: { value: { value: true } } } } },
			closure: { term: { binding: { annotation: { variable: result.answer.predicate } } } },
		});
	});

	it.each(modes)("checks occurrences in a %s binder's predicate field", mode => {
		expect(() =>
			runEB(mkCtx(), function* () {
				const meta = yield* EB.freshMeta(0, NF.Type);
				const term = mode === "Psi" ? C.Psi("s", C.Var(meta), D.type("Num")) : C.Phi("P", C.Var(meta), D.type("Num"));
				const value = yield* NF.normalize(term);
				return yield* Eff.with([Sub.subst.handlers()], () => U.unify(V.Flex(meta), value, 0));
			}),
		).toThrow("Occurs check failed");
	});

	it("counts runtime arguments through state and predicate binders", () => {
		const type = binder("Phi", C.Psi("s", EB.Unrestricted, C.Pi("x", "Explicit", D.type("Num"), D.type("Num"))));
		expect(
			runNF(mkCtx(), function* () {
				return yield* NF.arity(yield* NF.normalize(type));
			}),
		).toBe(1);
	});

	it("prints all four application modes", () => {
		const displays = runNF(mkCtx(), function* () {
			return yield* M.traverse(["Explicit", "Implicit", "Psi", "Phi"] as const, mode =>
				EB.Display.Term(C.App(mode, C.Var(C.Vars.Foreign("f")), C.Var(C.Vars.Foreign("a")))),
			);
		});
		expect(displays).toMatchInlineSnapshot(`
			[
			  "FFI.f FFI.a",
			  "FFI.f @FFI.a",
			  "FFI.f ψFFI.a",
			  "FFI.f ϕFFI.a",
			]
		`);
	});
	it("checks a lambda under a predicate contract and its call state", () => {
		const result = runEB(mkCtx(), function* () {
			const type = yield* NF.normalize(C.Phi("P", predicateType, C.Psi("s", C.Var(EB.Bound(0)), C.Pi("x", "Explicit", D.type("Num"), D.type("Num")))));
			return yield* EB.check(parseExpr("\\x -> x"), type);
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer[0]).toMatchObject({
			binding: { type: "Phi" },
			body: { binding: { type: "Psi", requirement: { type: "Var", variable: { index: 0 } } }, body: { binding: { type: "Lambda" } } },
		});
	});

	it.fails("preserves runtime argument arity for a typed foreign state application", () => {
		const declaration = elaborateFrom("Num -> Num");
		const type = runNF(mkCtx(), () => NF.normalize(declaration.structure.term), declaration.registry);
		const ctx: EB.Context = {
			...mkCtx(),
			imports: { ...mkCtx().imports, external: [C.Var(C.Vars.Foreign("external")), type, []] },
			ffi: { ...mkCtx().ffi, external: { arity: 1, compute: value => value } },
		};
		const result = runEB(ctx, () => EB.infer(parseExpr("external 7")));
		assert(!Eff.failed(result.answer));
		const [term] = result.answer;
		const value = runNF(ctx, () => NF.normalize(term), result.registry);
		expect(runNF(ctx, () => NF.view(value), result.registry).value).toMatchObject({ type: "Lit", value: { value: 7 } });
	});
});
