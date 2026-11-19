import assert from "node:assert";
import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { mkCtx, runNF } from "../../elaboration/inference/__tests__/util";
import { VerificationServiceV2 } from "../V2/service";
import { Validity } from "../validity";

describe("Refinement inference requests", () => {
	it("keeps the inferred value request on the lambda and checks a written contract as given", () => {
		const source = String.raw`
foreign Fetch: Effect String Num;
let fetch: (st |- key: String [| \k -> live st Fetch |]) -> Num = \key -> suspend @Fetch key;
let relay = \key -> fetch key;
let declared: String -> Num = \key -> fetch key;
`;
		const ds = elaborateModule(source).declarations;
		const relay = ds.find(d => d.name === "relay")?.elaborated;
		const declared = ds.find(d => d.name === "declared")?.elaborated;
		assert(relay && declared);
		const predicates = Object.values(relay.registry).filter(entry => entry.kind === "Predicate");
		expect(predicates).toHaveLength(2);
		expect(relay.tm).toMatchObject({
			binding: { type: "Psi", requirement: { body: { func: { variable: { type: "Meta" } } } } },
			body: {
				type: "Ann",
				term: { binding: { annotation: { type: "Modal", modalities: { liquid: { body: { func: { func: { variable: { type: "Meta" } } } } } } } } },
			},
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
		expect(callback.binding.requirement).toMatchObject({ body: { type: "App", func: meta, arg: value } });
		expect(callback.body).toMatchObject({
			binding: {
				type: "Pi",
				annotation: {
					type: "Modal",
					term: { type: "Lit", value: { type: "Atom", value: "String" } },
					modalities: {
						quantity: Q.One,
						liquid: { body: { type: "App", func: { type: "App", func: meta, arg: { type: "Var", variable: { type: "Bound", index: 1 } } }, arg: value } },
					},
				},
			},
		});
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
