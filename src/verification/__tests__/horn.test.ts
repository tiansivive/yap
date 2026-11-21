import { describe, expect, it } from "vitest";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as Metas from "@yap/elaboration/shared/metas";
import { defaultContext } from "@yap/shared/lib/constants";
import { Bool, Num } from "@yap/shared/literals";
import * as Horn from "../horn";
import { infer } from "../V2/service";
import { Build, DSL } from "../solver/ivl";
import { Validity } from "../validity";

const C = NF.Constructors;
const { and, eq, gt, lt, or } = NF.DSL.Binop;
const { not } = NF.DSL.Unop;
const num = (n: number) => C.Lit(Num(n));
const annotation = C.Atom("Num");
const binder = (lvl: number): Horn.Binder => ({ lvl, name: "v" + lvl, annotation });
const [x, y] = [0, 1].map(C.Rigid);
const registry = [1, 2, 3].reduce((r, id) => Metas.register(r, { kind: "Predicate", meta: EB.Meta(id, 0), annotation }), Metas.empty);
const hole = (id: number, ...args: NF.Value[]) => args.reduce((f, a) => C.App(f, a, "Explicit"), C.Flex(EB.Meta(id, 0)));
const scope = { binders: [binder(0)], premises: [hole(1, x)] };
const solve = (constraints: Horn.Constraint[]) => Horn.solve(constraints, registry);
const shape = (nf: NF.Value): object => {
	const v = NF.unwrapNeutral(nf);
	switch (v.type) {
		case "External":
			return { type: v.type, name: v.name, args: v.args.map(shape) };
		case "Lit":
			return { type: v.type, value: v.value };
		default:
			return v.type === "Var" && v.variable.type === "Bound" ? { type: "Neutral", value: { type: "Var", variable: v.variable } } : nf;
	}
};

describe("Solving emitted Horn constraints", () => {
	it("accumulates conjuncts and guards under one set of formal parameters", () => {
		const constraints = [
			{ ...scope, goal: gt(x, num(0)) },
			{ ...scope, goal: lt(x, num(10)) },
			{ binders: [binder(1)], premises: [hole(1, y), gt(y, num(2))], goal: lt(y, num(5)) },
		];
		const predicate = solve(constraints).get(1);
		expect(predicate?.params).toEqual(scope.binders);
		expect(predicate?.body).toMatchObject(shape(and(and(gt(x, num(0)), lt(x, num(10))), or(not(gt(x, num(2))), lt(x, num(5))))));
		const assignment = infer(constraints, defaultContext, registry);
		const use = (n: number) => DSL.eq(Build.hole(1, [Build.num(n, Build.Real)]), Build.bool(true));
		expect(Validity.check(use(1), assignment).tag).toBe("valid");
		expect(Validity.check(use(6), assignment).tag).toBe("invalid");
	});

	it("rebinds reordered formals simultaneously across occurrences of one predicate", () => {
		const binders = [binder(0), binder(1)];
		const assignment = solve([
			{ binders, premises: [hole(1, x, y)], goal: gt(x, y) },
			{ binders, premises: [eq(hole(1, y, x), C.Lit(Bool(true)))], goal: lt(y, x) },
		]);
		expect(assignment.get(1)?.body).toMatchObject(shape(and(gt(x, y), lt(x, y))));
	});

	it("discharges a reflexive equality on an ambient variable while inferring a local predicate", () => {
		const assignment = solve([
			{ ...scope, goal: gt(x, num(0)) },
			{ ...scope, goal: eq(y, C.Rigid(1)) },
		]);
		expect(assignment.get(1)?.body).toMatchObject(shape(gt(x, num(0))));
	});

	it("selects the innermost eligible assumption and projects a fresh alias", () => {
		const assignment = solve([{ binders: [binder(0), binder(1)], premises: [hole(1, x), hole(2, x), hole(3, y), eq(y, x)], goal: gt(x, num(0)) }]);
		expect(assignment.get(2)?.body).toMatchObject(shape(gt(x, num(0))));
		expect(assignment.get(1)?.body).toMatchObject(shape(C.Lit(Bool(true))));
		expect(assignment.get(3)?.body).toMatchObject(shape(C.Lit(Bool(true))));
	});

	it("keeps dependent premises and independent callback goals open", () => {
		const constraints = [
			{ ...scope, goal: hole(2, x) },
			{ ...scope, premises: [hole(2, x)], goal: gt(x, num(0)) },
			{ binders: [], premises: [], goal: hole(3, num(1)) },
		];
		const assignment = solve(constraints);
		expect([...assignment.keys()]).toEqual([2]);
		expect(assignment.get(2)?.body).toMatchObject(shape(gt(x, num(0))));
		const open = DSL.eq(Build.hole(3, [DSL.int(1)]), Build.bool(true));
		expect(Validity.check(open, infer(constraints, defaultContext, registry)).tag).toBe("unknown");
	});

	it("recognizes reflexive predicate goals and separately allocated guards", () => {
		const concrete = lt(x, num(10));
		const guarded = { ...scope, premises: [...scope.premises, not(gt(x, num(0)))] };
		const assignment = solve([
			{ ...scope, goal: concrete },
			{ ...guarded, goal: hole(1, x) },
			{ ...guarded, goal: not(gt(C.Rigid(0), num(0))) },
			{ binders: [], premises: [], goal: hole(1, num(1)) },
		]);
		expect(assignment.get(1)?.body).toMatchObject(shape(concrete));
	});

	it.each([
		{ ...scope, premises: [hole(1, x, x)], goal: gt(x, num(0)) },
		{ ...scope, premises: [hole(1, num(0))], goal: gt(x, num(0)) },
		{ ...scope, binders: [binder(0), binder(0)], goal: gt(x, num(0)) },
		{ binders: [binder(0), binder(1)], premises: [hole(1, x), gt(y, num(0))], goal: lt(x, num(1)) },
		{ ...scope, goal: C.Exists("y", annotation, { ctx: defaultContext, value: gt(y, x) }) },
		{ ...scope, goal: not(hole(1, num(0))) },
	])("leaves a requirement outside the direct fragment open (%#)", constraint => {
		expect(solve([constraint]).size).toBe(0);
	});
});
