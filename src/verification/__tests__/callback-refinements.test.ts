import assert from "node:assert";
import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { mkCtx, runNF } from "../../elaboration/inference/__tests__/util";
import { run } from "../V2/effects";
import { VerificationServiceV2 } from "../V2/service";
import { propagate } from "../V2/utils/refinements";

describe("Callback input refinements", () => {
	it.each([
		["String", []],
		["String -> Num", ["State", "String"]],
		["(String -> Num) -> Num", ["State", "State", "String"]],
		["String -> Num -> Num", ["Num", "State", "State", "String"]],
		["(n: Num) => String -> Num", ["Num", "State", "String"]],
		["(a: Type) => String -> Num", ["State", "String", "Type"]],
		["(f: String -> Num) => Bool -> Num", ["Bool", "State", "State", "String"]],
		[String.raw`(key: String [| \v -> false |]) -> Num`, ["State"]],
	] as const)("opens the omitted callback inputs of %s when checking a lambda", (domain, expected) => {
		const [declaration] = elaborateModule(String.raw`let f: (get: ${domain}) -> Num = \get -> 0;`).declarations;
		assert(declaration.elaborated, declaration.error);
		const { tm, ty, ctx, registry } = declaration.elaborated;
		const checked = VerificationServiceV2().letdec("f", tm, ty, ctx, registry);
		assert(!Eff.failed(checked.answer));
		const inputs = Object.values(checked.registry)
			.filter(entry => entry.kind === "Predicate")
			.map(entry => {
				const kind = runNF(ctx, () => NF.quote(ctx.env.length, entry.annotation), checked.registry);
				assert(kind.type === "Abs" && kind.binding.type === "Pi");
				const input = kind.binding.annotation;
				assert(input.type === "Lit" && input.value.type === "Atom");
				expect(kind.body).toMatchObject({ type: "Lit", value: { value: "Bool" } });
				expect(entry.solution).toBeUndefined();
				return input.value.value;
			});
		expect(inputs.sort()).toEqual(expected);
	});

	it("drops the outer modal and preserves existing holes and the dependent result", () => {
		const C = EB.Constructors;
		const D = EB.DSL;
		const ctx = mkCtx();
		const num = D.type("Num");
		const checked = run(ctx, Metas.empty, function* () {
			const stateHole = yield* EB.Liquid.hole(NF.State);
			const inputHole = yield* EB.Liquid.hole(yield* NF.normalize(num));
			const input = C.Modal(num, { quantity: "Many", liquid: C.Var(inputHole) });
			const result = C.Modal(num, { quantity: "Many", liquid: C.Lambda("v", "Explicit", D.eq(D.bound(0), D.bound(1)), num) });
			const callback = C.Psi("s", C.Var(stateHole), C.Pi("x", "Explicit", input, result));
			const outerHole = yield* EB.Liquid.hole(yield* NF.normalize(callback));
			const wrapped = C.Modal(callback, { quantity: "One", liquid: C.Var(outerHole) });
			const opened = yield* propagate(yield* NF.normalize(wrapped));
			return { term: yield* NF.quote(ctx.env.length, opened), stateHole, inputHole };
		});
		assert(!Eff.failed(checked.answer));
		const { term, stateHole, inputHole } = checked.answer;
		expect(term).toMatchObject({
			binding: { type: "Psi", requirement: { variable: stateHole } },
			body: {
				binding: { type: "Pi", annotation: { modalities: { liquid: { variable: inputHole } } } },
				body: { modalities: { liquid: { body: { func: { arg: { variable: { index: 0 } } }, arg: { variable: { index: 1 } } } } } },
			},
		});
		expect(Object.keys(checked.registry)).toHaveLength(3);
	});
});
