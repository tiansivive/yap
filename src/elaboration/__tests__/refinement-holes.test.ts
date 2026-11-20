import assert from "node:assert";
import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import { runNF } from "../inference/__tests__/util";
import { elaborateModule } from "./module";

describe("predicate holes in elaborated lambdas", () => {
	it.each([
		[String.raw`foreign fetch: String -> Num; let relay = \key -> fetch key;`, { type: "Lit", value: { type: "Atom", value: "String" } }],
		[String.raw`let invoke = \get -> (get "config") + 1;`, { type: "Abs", binding: { type: "Psi" }, body: { binding: { type: "Pi" } } }],
	])("shares the inferred parameter and state predicates in %s", (source, domain) => {
		const declaration = elaborateModule(source).declarations.at(-1);
		assert(declaration?.elaborated, declaration?.error);
		const { tm, ty, ctx, registry } = declaration.elaborated;
		assert(tm.type === "Abs" && tm.binding.type === "Psi" && tm.body.type === "Ann");
		const state = tm.binding.requirement;
		const lambda = tm.body.term;
		assert(state.type === "Var" && state.variable.type === "Meta");
		assert(lambda.type === "Abs" && lambda.binding.type === "Lambda" && lambda.binding.annotation.type === "Modal");
		const input = lambda.binding.annotation.modalities.liquid;
		assert(input.type === "Var" && input.variable.type === "Meta");

		const stateType = { type: "Lit", value: { type: "Atom", value: "State" } };
		const predicates = Object.values(registry).filter(entry => entry.kind === "Predicate");
		expect(predicates).toHaveLength(2);
		const scope = EB.bind(ctx, { type: "Let", variable: declaration.name }, ty);
		const quote = (value: NF.Value) => runNF(scope, () => NF.quote(scope.env.length, value), registry);
		const expectPredicate = (meta: EB.Meta, parameter: typeof domain | typeof stateType) => {
			const entry = Metas.entry(registry, meta.val);
			expect(entry.kind).toBe("Predicate");
			expect(entry.solution).toBeUndefined();
			expect(quote(entry.annotation)).toMatchObject({ binding: { type: "Pi", annotation: parameter }, body: { value: { type: "Atom", value: "Bool" } } });
		};
		expectPredicate(input.variable, domain);
		expectPredicate(state.variable, stateType);
		const annotation = { type: "Modal", term: domain, modalities: { liquid: { type: "Var", variable: input.variable } } };
		const pi = { binding: { type: "Pi", annotation } };
		expect(lambda.binding.annotation).toMatchObject(annotation);
		expect(tm.body.ann).toMatchObject(pi);
		expect(quote(ty)).toMatchObject({ binding: { type: "Psi", requirement: { type: "Var", variable: state.variable } }, body: pi });
	});

	it.each([
		["String", { type: "Lit", value: { type: "Atom", value: "String" } }],
		[String.raw`String [| \v -> false |]`, { type: "Modal", modalities: { liquid: { type: "Abs", body: { value: { value: false } } } } }],
	])("preserves the written parameter type %s", (type, annotation) => {
		const [declaration] = elaborateModule(String.raw`let fixed: (k: ${type}) -> Num = \k -> 1;`).declarations;
		assert(declaration.elaborated, declaration.error);
		const { tm, registry } = declaration.elaborated;
		expect(Object.values(registry).filter(entry => entry.kind === "Predicate")).toEqual([]);
		expect(tm).toMatchObject({ body: { binding: { annotation } } });
	});
});
