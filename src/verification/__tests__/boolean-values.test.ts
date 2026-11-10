import assert from "node:assert";
import { describe, expect, it } from "vitest";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";
import { defaultContext } from "@yap/shared/lib/constants";
import { run } from "../V2/effects";
import { term } from "../V2/logic/translate";
import { Build } from "../solver/ivl/build";

describe("Boolean values in translation", () => {
	const num = NF.Constructors.Lit({ type: "Atom", value: "Num" });
	const ctx = ["a", "b"].reduce((ctx, variable) => EB.bind(ctx, { type: "Pi", variable }, num), defaultContext);
	const a = NF.Constructors.Rigid(0);
	const b = NF.Constructors.Rigid(1);

	it.each([
		[EB.DSL.eq, "="],
		[EB.DSL.neq, "!="],
		[EB.DSL.gt, ">"],
		[EB.DSL.gte, ">="],
		[EB.DSL.lt, "<"],
		[EB.DSL.lte, "<="],
	] as const)("retains both operands (%#)", (operator, atom) => {
		const { answer } = run(ctx, {}, function* () {
			return [
				yield* term(a),
				yield* term(b),
				yield* term(yield* NF.evaluate(operator(EB.DSL.bound(1), EB.DSL.num(0)))),
				yield* term(yield* NF.evaluate(operator(EB.DSL.bound(0), EB.DSL.num(5)))),
			];
		});
		assert(!Eff.failed(answer));
		const [left, right, first, second] = answer;

		expect(first).not.toEqual(second);
		expect(first).toEqual(Build.prop(Build.atom(atom, left, Build.num(0, Build.Real))));
		expect(second).toEqual(Build.prop(Build.atom(atom, right, Build.num(5, Build.Real))));
	});

	it.each([
		[EB.DSL.and, Build.and],
		[EB.DSL.or, Build.or],
	] as const)("retains the comparisons inside a connective (%#)", (operator, connective) => {
		const { answer } = run(ctx, {}, function* () {
			return [
				yield* term(a),
				yield* term(b),
				yield* term(yield* NF.evaluate(operator(EB.DSL.gt(EB.DSL.bound(1), EB.DSL.num(0)), EB.DSL.not(EB.DSL.eq(EB.DSL.bound(0), EB.DSL.num(5)))))),
			];
		});
		assert(!Eff.failed(answer));
		const [left, right, value] = answer;

		expect(value).toEqual(Build.prop(connective(Build.atom(">", left, Build.num(0, Build.Real)), Build.not(Build.atom("=", right, Build.num(5, Build.Real))))));
	});
});
