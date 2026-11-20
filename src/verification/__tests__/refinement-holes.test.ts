import assert from "node:assert";
import { describe, expect, it, vi } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Row from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { mkCtx, runNF } from "../../elaboration/inference/__tests__/util";
import { VerificationServiceV2 } from "../V2/service";
import { Validity } from "../validity";
import { Build } from "../solver/ivl/build";

const C = EB.Constructors;

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
			assert(hole?.type === "Var" && hole.variable.type === "Meta");
			expect(Metas.entry(registry, hole.variable.val).kind).toBe("Predicate");
			expect(Metas.entry(registry, state.variable.val).kind).toBe("Predicate");
			const input = {
				type: "Modal",
				modalities: { liquid: { type: "Var", variable: hole.variable } },
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
		const kind = EB.Constructors.Pi("get", "Explicit", callback, EB.DSL.type("Bool"));
		const registry = Metas.register(Metas.empty, { meta, kind: "Predicate", annotation: runNF(ctx, () => NF.evaluate(kind)) });
		const marker = EB.Constructors.Var(meta);
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

	it("keeps an explicit ψ predicate and existing callback input and result holes", () => {
		const ctx = mkCtx();
		const domain = EB.DSL.type("String");
		const num = EB.DSL.type("Num");
		const meta = EB.Meta(21, 0);
		const kind = runNF(ctx, () => NF.evaluate(EB.Constructors.Pi("v", "Explicit", domain, EB.DSL.type("Bool"))));
		const registry = Metas.register(Metas.empty, { meta, kind: "Predicate", annotation: kind });
		const refined = EB.Constructors.Modal(domain, { quantity: Q.Many, liquid: EB.Constructors.Var(meta) });
		const post = EB.Meta(22, 2);
		const postKind = runNF(ctx, () => NF.evaluate(EB.Constructors.Pi("v", "Explicit", num, EB.DSL.type("Bool"))));
		const existing = Metas.register(registry, { meta: post, kind: "Predicate", annotation: postKind });
		const result = EB.Constructors.Modal(num, { quantity: Q.Many, liquid: EB.Constructors.Var(post) });
		const fn = EB.Constructors.Psi("cb", EB.Unrestricted, EB.Constructors.Pi("key", "Explicit", refined, result));
		const tm = EB.Constructors.Lambda("get", "Explicit", EB.Constructors.Lit({ type: "Num", value: 1 }), fn);
		const expected = runNF(ctx, () => NF.evaluate(EB.Constructors.Pi("get", "Explicit", fn, num)), existing);
		const checked = VerificationServiceV2().check(tm, expected, ctx, existing);
		assert(!Eff.failed(checked.answer));
		expect(checked.registry).toEqual(existing);
	});
	it("instantiates the same inferred scalar predicate at each application state", () => {
		const previous = EB.bind(mkCtx(), { type: "Pi", variable: "previous" }, NF.State);
		const ctx = EB.bind(previous, { type: "Pi", variable: "current" }, NF.State);
		const num = EB.DSL.type("Num");
		const meta = EB.Meta(30, ctx.env.length + 1);
		const unary = runNF(ctx, () => NF.evaluate(C.Pi("v", "Explicit", num, EB.DSL.type("Bool"))));
		const registered = Metas.register(Metas.empty, { kind: "Predicate", meta, annotation: unary });
		const input = C.Modal(num, { quantity: Q.Many, liquid: C.Var(meta) });
		const lambda = C.Psi("s", EB.Unrestricted, C.Lambda("x", "Explicit", EB.DSL.num(1), input));
		const original = runNF(ctx, () => NF.evaluate(C.Psi("s", EB.Unrestricted, C.Pi("x", "Explicit", input, num))), registered);
		const { answer, registry } = VerificationServiceV2().synth(lambda, ctx, registered);
		assert(!Eff.failed(answer));
		const contextual = Object.values(registry).find(entry => entry.meta.val !== meta.val);
		assert(contextual?.kind === "Predicate");
		[original, answer[0]].forEach(type => {
			const psi = runNF(ctx, () => NF.view(type), registry);
			assert(psi.kind === "Sealed" && psi.value.type === "Abs" && psi.value.binder.type === "Psi");
			const fn = psi.value;
			[0, 1].forEach(level => {
				const instantiated = runNF(ctx, () => NF.apply(fn.binder, fn.closure, NF.Constructors.Rigid(level)), registry);
				const term = runNF(ctx, () => NF.quote(ctx.env.length, instantiated), registry);
				expect(term).toMatchObject({
					binding: {
						annotation: {
							modalities: {
								liquid: {
									type: "App",
									func: { variable: contextual.meta },
									arg: { variable: { type: "Bound", index: EB.lvl2idx(ctx, level) } },
								},
							},
						},
					},
				});
			});
		});
	});

	it("checks function type domains and codomains against Type", () => {
		const ctx = mkCtx();
		const num = EB.DSL.type("Num");
		const unavailable = C.Modal(num, { quantity: Q.Many, liquid: C.Lambda("v", "Explicit", EB.DSL.bool(false), num) });
		const family = C.Var(C.Vars.Foreign("Family"));
		const annotation = runNF(ctx, () => NF.evaluate(C.Pi("x", "Explicit", unavailable, EB.Type)));
		const fixed = C.Psi("s", undefined, C.Pi("x", "Explicit", EB.DSL.type("String"), num));
		const callback = runNF(ctx, () => NF.evaluate(fixed));
		const withFamily: EB.Context = {
			...ctx,
			imports: { ...ctx.imports, Family: [family, annotation, []] },
			ffi: { ...ctx.ffi, Family: { arity: 1, compute: () => callback } },
		};
		const result = C.App("Explicit", family, EB.DSL.num(1));
		const checker = VerificationServiceV2();
		[C.Psi("s", EB.Unrestricted, result), C.Pi("x", "Explicit", result, num), C.Psi("s", EB.Unrestricted, EB.DSL.num(1))].forEach(term => {
			const { answer } = checker.check(term, NF.Type, withFamily, Metas.empty);
			assert(!Eff.failed(answer));
			expect(Validity.check(answer.vc).tag).toBe("invalid");
		});
		const lambda = checker.synth(C.Lambda("get", "Explicit", EB.DSL.num(1), result), withFamily, Metas.empty);
		assert(!Eff.failed(lambda.answer));
		expect(Validity.check(lambda.answer[1].vc).tag).toBe("invalid");
		const checked = checker.check(fixed, NF.Type, ctx, Metas.empty);
		assert(!Eff.failed(checked.answer));
		expect(Validity.check(checked.answer.vc).tag).toBe("valid");
		expect(checked.registry).toEqual(Metas.empty);
	});

	it("keeps the outer written result when a function ascription widens its result", () => {
		const ctx = mkCtx();
		const num = EB.DSL.type("Num");
		const one = EB.DSL.num(1);
		const singleton = C.Modal(num, { quantity: Q.Many, liquid: C.Lambda("v", "Explicit", EB.DSL.eq(EB.DSL.bound(0), one), num) });
		const pi = (result: EB.Term) => C.Pi("x", "Explicit", num, result);
		const precise = C.Ann(C.Lambda("x", "Explicit", one, num), pi(singleton));
		const widened = C.Ann(precise, pi(num));
		const expected = runNF(ctx, () => NF.evaluate(singleton));
		(
			[
				[precise, "valid"],
				[widened, "invalid"],
			] as const
		).forEach(([term, verdict]) => {
			const { answer } = VerificationServiceV2().check(C.App("Explicit", term, one), expected, ctx, Metas.empty);
			assert(!Eff.failed(answer));
			expect(Validity.check(answer.vc).tag).toBe(verdict);
		});
	});

	it("retains the same callback input holes across repeated ascriptions", () => {
		const ctx = mkCtx();
		const num = EB.DSL.type("Num");
		const callback = C.Psi("s", undefined, C.Pi("key", "Explicit", EB.DSL.type("String"), num));
		const signature = C.Pi("get", "Explicit", callback, num);
		const lambda = C.Lambda("get", "Explicit", EB.DSL.num(1), callback);
		const once = C.Ann(lambda, signature);
		const { answer, registry } = VerificationServiceV2().synth(C.Ann(once, signature), ctx, Metas.empty);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer[1].vc).tag).toBe("valid");
		const quoted = runNF(ctx, () => NF.quote(ctx.env.length, answer[0]), registry);
		assert(quoted.type === "Abs" && quoted.binding.type === "Pi");
		const get = quoted.binding.annotation;
		assert(get.type === "Abs" && get.binding.type === "Psi" && get.body.type === "Abs" && get.body.binding.annotation.type === "Modal");
		const state = get.binding.requirement;
		const input = get.body.binding.annotation.modalities.liquid;
		assert(state?.type === "Var" && state.variable.type === "Meta");
		assert(input?.type === "App" && input.func.type === "Var" && input.func.variable.type === "Meta");
		expect(input.arg).toMatchObject({ type: "Var", variable: { type: "Bound", index: 0 } });
		expect(Object.values(registry).map(entry => entry.meta.val)).toEqual([state.variable.val, input.func.variable.val]);
	});

	it("retains checked callback inputs under a quantity on the enclosing signature", () => {
		const ctx = mkCtx();
		const str = EB.DSL.type("String");
		const num = EB.DSL.type("Num");
		const always = C.Lambda("v", "Explicit", EB.DSL.bool(true), str);
		const fixed = C.Psi("s", EB.Unrestricted, C.Pi("key", "Explicit", C.Modal(str, { quantity: Q.Many, liquid: always }), num));
		const silent = C.Psi("s", undefined, C.Pi("key", "Explicit", str, num));
		const signature = (callback: EB.Term) => C.Pi("get", "Explicit", callback, num);
		const ref = C.Var(C.Vars.Foreign("lift"));
		const original = runNF(ctx, () => NF.evaluate(signature(fixed)));
		const withLift: EB.Context = {
			...ctx,
			imports: { ...ctx.imports, lift: [ref, original, []] },
			ffi: { ...ctx.ffi, lift: { arity: 1, compute: () => NF.Type } },
		};
		const term = C.Ann(ref, C.Modal(signature(silent), { quantity: Q.One }));
		const { answer, registry } = VerificationServiceV2().synth(term, withLift, Metas.empty);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer[1].vc).tag).toBe("valid");
		const result = runNF(withLift, () => NF.quote(withLift.env.length, answer[0]), registry);
		expect(result).toMatchObject({
			type: "Modal",
			modalities: { quantity: Q.One },
			term: {
				binding: {
					annotation: {
						binding: { type: "Psi", requirement: { type: "Abs" } },
						body: { binding: { annotation: { type: "Modal", modalities: { liquid: { type: "Abs" } } } } },
					},
				},
			},
		});
		expect(registry).toEqual(Metas.empty);
	});

	it("synthesizes the enclosing variant when its payload is an ascribed function", () => {
		const ctx = mkCtx();
		const num = EB.DSL.type("Num");
		const fn = C.Pi("u", "Explicit", num, num);
		const variant = C.Variant(
			Row.Constructors.Row([
				{ label: "ok", value: fn },
				{ label: "no", value: num },
			]),
		);
		const payload = C.Ann(C.Lambda("u", "Explicit", EB.DSL.num(1), num), fn);
		const { answer, registry } = VerificationServiceV2().synth(C.Ann(C.Tagged("ok", payload), variant), ctx, Metas.empty);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer[1].vc).tag).toBe("valid");
		const result = runNF(ctx, () => NF.view(answer[0]), registry);
		expect(result).toMatchObject(NF.View.Sealed(NF.Patterns.Variant));
	});
});
