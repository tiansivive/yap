import assert from "node:assert";
import { describe, expect, it, vi } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { mkCtx, runNF } from "../../elaboration/inference/__tests__/util";
import { VerificationServiceV2 } from "../V2/service";
import { Validity } from "../validity";
import { Build } from "../solver/ivl/build";

describe("Refinement inference requests", () => {
	it("shares the input predicate between an inferred lambda and its returned Π and checks a written contract as given", () => {
		const source = String.raw`
foreign Fetch: Effect String Num;
let fetch: (st |- key: String [| \k -> live st Fetch |]) -> Num = \key -> suspend @Fetch key;
let relay = \key -> fetch key;
let declared: String -> Num = \key -> fetch key;
let invoke = \get -> (get "config") + 1;
`;
		const ds = elaborateModule(source).declarations;
		const relay = ds.find(d => d.name === "relay")?.elaborated;
		const declared = ds.find(d => d.name === "declared")?.elaborated;
		assert(relay && declared);
		const predicates = Object.values(relay.registry).filter(entry => entry.kind === "Predicate");
		expect(predicates).toHaveLength(2);
		["relay", "invoke"].forEach(name => {
			const inferred = ds.find(d => d.name === name)?.elaborated;
			assert(inferred);
			const { tm, ty, registry } = inferred;
			assert(tm.type === "Abs" && tm.binding.type === "Psi" && tm.body.type === "Ann");
			const state = tm.binding.requirement;
			assert(state?.type === "Var" && state.variable.type === "Meta");
			const lambda = tm.body.term;
			assert(lambda.type === "Abs" && lambda.binding.annotation.type === "Modal");
			const hole = lambda.binding.annotation.modalities.liquid;
			assert(hole?.type === "App" && hole.func.type === "Var" && hole.func.variable.type === "Meta");
			expect(Metas.entry(registry, hole.func.variable.val).kind).toBe("Predicate");
			expect(Metas.entry(registry, state.variable.val).kind).toBe("Predicate");
			const input = {
				type: "Modal",
				modalities: { liquid: { type: "App", func: { variable: hole.func.variable }, arg: { type: "Var", variable: EB.Bound(0) } } },
			};
			const pi = { binding: { type: "Pi", annotation: input } };
			expect(lambda.binding.annotation).toMatchObject(input);
			expect(tm.body.ann).toMatchObject(pi);
			const within = EB.bind(inferred.ctx, { type: "Let", variable: name }, ty);
			const returned = runNF(within, () => NF.quote(within.env.length, ty), registry);
			expect(returned).toMatchObject({ binding: { type: "Psi", requirement: { variable: state.variable } }, body: pi });
		});
		expect(Object.values(declared.registry).filter(entry => entry.kind === "Predicate")).toEqual(predicates);
		const { tm, ty, ctx, registry } = declared;
		const { answer } = VerificationServiceV2().letdec("declared", tm, ty, ctx, registry);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer.vc).tag).toBe("invalid");
	});

	it.each([
		["String -> Num", 2],
		["(k: <1>String) -> Num", 2],
		[String.raw`(k: <1>String [| \k -> true |]) -> Num`, 1],
		[String.raw`(k: <1>String [| \k -> false |]) -> Num`, 1],
		[String.raw`(key: String [| \key -> true |]) -> Num`, 1],
		["(String -> Num) -> Num", 3],
		["String -> String -> Num", 4],
	] as const)("opens only the silent callback preconditions of %s", (signature, count) => {
		const source = String.raw`let use: (get: ${signature}) -> Num = \get -> 1;`;
		const d = elaborateModule(source).declarations[0];
		assert(d.elaborated, d.error);
		const { tm, ty, ctx, registry } = d.elaborated;
		const checked = VerificationServiceV2().letdec("use", tm, ty, ctx, registry);
		assert(!Eff.failed(checked.answer));
		expect(Validity.check(checked.answer.vc).tag).toBe("valid");
		const predicates = Object.values(checked.registry).filter(entry => entry.kind === "Predicate");
		expect(predicates).toHaveLength(count);
	});

	it("retains the written assumption on a record parameter", () => {
		const source = String.raw`
foreign Fetch: Effect String Num;
let fetch: (st |- key: String [| \k -> live st Fetch |]) -> Num = \key -> suspend @Fetch key;
let never: (r: { x: Num } [| \v -> false |]) -> Num = \r -> fetch "config";
`;
		const declaration = elaborateModule(source).declarations.find(d => d.name === "never");
		assert(declaration?.elaborated, declaration?.error);
		const { tm, ty, ctx, registry } = declaration.elaborated;
		const { answer } = VerificationServiceV2().letdec("never", tm, ty, ctx, registry);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer.vc).tag).toBe("valid");
	});

	it("places both predicates inside the callback using its invocation state", () => {
		const ctx = mkCtx();
		const domain = EB.Constructors.Modal(EB.DSL.type("String"), { quantity: Q.One });
		const fn = EB.Constructors.Psi("cb", undefined, EB.Constructors.Pi("key", "Explicit", domain, EB.DSL.type("Num")));
		const tm = EB.Constructors.Lambda("get", "Explicit", EB.Constructors.Lit({ type: "Num", value: 1 }), fn);
		const { answer, registry } = VerificationServiceV2().synth(tm, ctx, Metas.empty);
		assert(!Eff.failed(answer));
		const type = runNF(ctx, () => NF.quote(ctx.env.length, answer[0]), registry);
		assert(type.type === "Abs" && type.binding.type === "Pi");
		const callback = type.binding.annotation;
		assert(callback.type === "Abs" && callback.binding.type === "Psi");
		const meta = { type: "Var", variable: { type: "Meta" } };
		const value = { type: "Var", variable: { type: "Bound", index: 0 } };
		expect(callback.binding.requirement).toMatchObject(meta);
		expect(callback.body).toMatchObject({
			binding: {
				type: "Pi",
				annotation: {
					type: "Modal",
					term: { type: "Lit", value: { type: "Atom", value: "String" } },
					modalities: {
						quantity: Q.One,
						liquid: { type: "App", func: meta, arg: value },
					},
				},
			},
		});
	});

	it("forwards a quantity-only callback using first-order quantifiers", () => {
		const ctx = mkCtx();
		const str = EB.DSL.type("String");
		const key = EB.Constructors.Modal(str, {
			quantity: Q.Many,
			liquid: EB.Constructors.Lambda("v", "Explicit", EB.Constructors.Lit({ type: "Bool", value: true }), str),
		});
		const callback = EB.Constructors.Psi("s", EB.Unrestricted, EB.Constructors.Pi("key", "Explicit", key, EB.DSL.type("Num")));
		const input = EB.Constructors.Modal(callback, { quantity: Q.One });
		const expected = runNF(ctx, () => NF.evaluate(EB.Constructors.Pi("get", "Explicit", input, input)));
		const term = EB.Constructors.Lambda("get", "Explicit", EB.DSL.bound(0), input);
		const forall = vi.spyOn(Build, "forall");
		try {
			const checked = VerificationServiceV2().check(term, expected, ctx, Metas.empty);
			assert(!Eff.failed(checked.answer));
			expect(Validity.check(checked.answer.vc).tag).toBe("valid");
			expect(forall.mock.calls.flatMap(([binders]) => binders.map(binder => binder.sort.tag))).not.toContain("Fn");
		} finally {
			forall.mockRestore();
		}
	});

	it.each([
		[true, true, "valid"],
		[false, true, "invalid"],
		[true, false, "invalid"],
	] as const)("checks a marked callback's ascribed result %s against expected result %s", (ascribedResult, expectedResult, verdict) => {
		const ctx = mkCtx();
		const num = EB.DSL.type("Num");
		const refine = (type: EB.Term, value: boolean) =>
			EB.Constructors.Modal(type, {
				quantity: Q.Many,
				liquid: EB.Constructors.Lambda("v", "Explicit", EB.Constructors.Lit({ type: "Bool", value }), type),
			});
		const callback = EB.Constructors.Psi("cb", EB.Unrestricted, EB.Constructors.Pi("x", "Explicit", refine(num, true), num));
		const meta = EB.Meta(21, 0);
		const kind = EB.Constructors.Pi("s", "Explicit", EB.State, EB.Constructors.Pi("get", "Explicit", callback, EB.DSL.type("Bool")));
		const registry = Metas.register(Metas.empty, { meta, kind: "Predicate", annotation: runNF(ctx, () => NF.evaluate(kind)) });
		const marker = EB.Constructors.App("Explicit", EB.Constructors.Var(meta), EB.Constructors.Var(EB.Bound(0)));
		const input = EB.Constructors.Modal(callback, { quantity: Q.Many, liquid: marker });
		const pi = (result: boolean) => EB.Constructors.Pi("get", "Explicit", input, refine(num, result));
		const lambda = EB.Constructors.Lambda("get", "Explicit", EB.Constructors.Lit({ type: "Num", value: 1 }), input);
		const term = EB.Constructors.Psi("s", EB.Unrestricted, EB.Constructors.Ann(lambda, pi(ascribedResult)));
		const expected = runNF(ctx, () => NF.evaluate(EB.Constructors.Psi("s", EB.Unrestricted, pi(expectedResult))), registry);
		const checked = VerificationServiceV2().check(term, expected, ctx, registry);
		assert(!Eff.failed(checked.answer));
		expect(Validity.check(checked.answer.vc).tag).toBe(verdict);
		expect(checked.registry).toEqual(registry);
	});

	it("keeps an explicit ψ predicate and an existing callback input hole", () => {
		const ctx = mkCtx();
		const domain = EB.DSL.type("String");
		const num = EB.DSL.type("Num");
		const meta = EB.Meta(21, 0);
		const kind = runNF(ctx, () => NF.evaluate(EB.Constructors.Pi("v", "Explicit", domain, EB.DSL.type("Bool"))));
		const registry = Metas.register(Metas.empty, { meta, kind: "Predicate", annotation: kind });
		const refined = EB.Constructors.Modal(domain, { quantity: Q.Many, liquid: EB.Constructors.Var(meta) });
		const fn = EB.Constructors.Psi("cb", EB.Unrestricted, EB.Constructors.Pi("key", "Explicit", refined, num));
		const tm = EB.Constructors.Lambda("get", "Explicit", EB.Constructors.Lit({ type: "Num", value: 1 }), fn);
		const expected = runNF(ctx, () => NF.evaluate(EB.Constructors.Pi("get", "Explicit", fn, num)), registry);
		const checked = VerificationServiceV2().check(tm, expected, ctx, registry);
		assert(!Eff.failed(checked.answer));
		expect(checked.registry).toEqual(registry);
	});
});
