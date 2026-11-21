import assert from "node:assert";
import { describe, expect, it } from "vitest";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import { defaultContext } from "@yap/shared/lib/constants";
import * as Eff from "@yap/utils/effects";
import * as Horn from "../horn";
import { run } from "../V2/effects";

const { Rigid: bound, Lit } = NF.Constructors;
const { and, eq, gt, lt } = NF.DSL.Binop;
const num = (value: number) => Lit({ type: "Num", value });
const hole = (id: number, ...args: NF.Value[]) =>
	args.reduce((f, arg) => NF.Constructors.App(f, arg, "Explicit"), NF.Constructors.Flex({ type: "Meta", val: id, lvl: 0 }));
const x = bound(0),
	y = bound(1);
const type = NF.Constructors.Pi("x", "Explicit", NF.Constructors.Atom("Num"), NF.Constructors.Closure(defaultContext, EB.DSL.type("Bool")));
const registry = [1, 2, 3].reduce<Metas.Registry>(
	(r, id) => Metas.register(r, { kind: "Predicate", meta: { type: "Meta", val: id, lvl: 0 }, annotation: type }),
	{},
);
const solve = (clauses: Horn.Constraint[], metas = registry) => {
	const { answer } = run(defaultContext, metas, () => Horn.solve(clauses));
	assert(!Eff.failed(answer));
	return answer;
};
const apply = (pred: NF.Value, value: number) => {
	const { answer } = run(defaultContext, registry, function* () {
		return (yield* NF.view(yield* NF.reduce(pred, num(value), "Explicit"))).value;
	});
	assert(!Eff.failed(answer) && answer.type === "Lit" && answer.value.type === "Bool");
	return answer.value.value;
};

describe("Direct inference on Yap predicates", () => {
	it("combines guarded requirements from different scopes under the same formal", () => {
		const one = [{ level: 0, premise: hole(1, x) }];
		const two = [{ level: 1, premise: and(hole(1, y), gt(y, num(2))) }];
		const a = solve([
			{ binders: one, goal: gt(x, num(0)) },
			{ binders: one, goal: lt(x, num(10)) },
			{ binders: two, goal: lt(y, num(5)) },
		]);
		expect([1, 6, 0].map(v => apply(a.get(1)!, v))).toEqual([true, false, false]);
	});
	it("abstracts a reordered spine by its positions across nested binders with the same spelling", () => {
		const binary = NF.Constructors.Pi(
			"x",
			"Explicit",
			NF.Constructors.Atom("Num"),
			NF.Constructors.Closure(defaultContext, EB.Constructors.Pi("x", "Explicit", EB.DSL.type("Num"), EB.DSL.type("Bool"))),
		);
		const metas = Metas.register({}, { kind: "Predicate", meta: { type: "Meta", val: 1, lvl: 0 }, annotation: binary });
		const result = solve([{ binders: [{ level: 0 }, { level: 1, premise: hole(1, y, x) }], goal: lt(x, y) }], metas).get(1);
		assert(result);
		const { answer: first } = run(defaultContext, metas, () => NF.reduce(result, num(2), "Explicit"));
		assert(!Eff.failed(first));
		expect([1, 3].map(v => apply(first, v))).toEqual([true, false]);
	});
	it("projects an isolated alias and selects the innermost predicate with the required level", () => {
		const binders = [
			{ level: 0, premise: and(hole(1, x), hole(2, x)) },
			{ level: 1, premise: and(hole(3, y), eq(y, x)) },
		];
		const a = solve([
			{ binders, goal: gt(x, num(0)) },
			{ binders, goal: eq(y, y) },
		]);
		expect([1, 2, 3].map(i => apply(a.get(i)!, 0))).toEqual([true, false, true]);
	});
	it("retains open callback dependencies and permits an independently defined goal", () => {
		const assumptions = (id: number) => [{ level: 0, premise: hole(id, x) }];
		const a = solve([
			{ binders: assumptions(1), goal: hole(2, x) },
			{ binders: assumptions(2), goal: gt(x, num(0)) },
			{ binders: [], goal: hole(3, num(1)) },
		]);
		expect([...a.keys()]).toEqual([2]);
	});
	it("discharges a repeated guard and a reflexive ambient goal", () => {
		const guard = lt(x, num(20)),
			binders = [{ level: 0, premise: and(hole(1, x), guard) }];
		const a = solve([
			{ binders, goal: lt(x, num(20)) },
			{ binders, goal: eq(y, y) },
		]);
		expect(apply(a.get(1)!, 20)).toBe(true);
	});
	it.each([
		{ binders: [{ level: 0, premise: hole(1, num(1)) }], goal: gt(x, num(0)) },
		{ binders: [{ level: 0, premise: hole(1, x, x) }], goal: gt(x, num(0)) },
		{ binders: [{ level: 0, premise: hole(1, x) }, { level: 0 }], goal: gt(x, num(0)) },
		{ binders: [{ level: 0, premise: hole(1, x) }, { level: 1 }], goal: gt(y, num(0)) },
		{
			binders: [
				{ level: 0, premise: hole(1, x) },
				{ level: 1, premise: gt(y, num(0)) },
			],
			goal: lt(x, num(1)),
		},
		{ binders: [{ level: 0, premise: hole(1, x) }], goal: NF.DSL.Unop.not(hole(1, x)) },
	])("leaves an unsupported scope or escaping variable open", c => expect(solve([c]).size).toBe(0));
});
