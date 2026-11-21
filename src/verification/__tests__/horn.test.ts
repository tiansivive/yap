import { describe, expect, it } from "vitest";
import * as Horn from "../horn";
import { Build, DSL, type IVL } from "../solver/ivl";
import { Validity } from "../validity";

const { and, eq, gt, int, lt, x, y } = DSL;
const binder = (name: string): IVL.Binder => ({ name, sort: Build.Int });
const hole = (id: IVL.Kappa, ...args: IVL.Term[]) => eq(Build.hole(id, args), Build.bool(true));

describe("Solving emitted Horn constraints", () => {
	it("accumulates conjuncts and guards under one set of formal parameters", () => {
		const scope = { binders: [binder("x")], premises: [hole(1, x)] };
		const guarded = { binders: [binder("y")], premises: [hole(1, y), gt(y, int(2))] };
		const assignment = Horn.solve([
			{ ...scope, goal: gt(x, int(0)) },
			{ ...scope, goal: lt(x, int(10)) },
			{ ...guarded, goal: lt(y, int(5)) },
		]);
		expect(assignment.get(1)).toEqual({
			params: [{ name: "x", sort: Build.Int }],
			body: and(gt(x, int(0)), lt(x, int(10)), DSL.implies(gt(x, int(2)), lt(x, int(5)))),
		});
		expect(Validity.check(hole(1, int(1)), assignment).tag).toBe("valid");
		expect(Validity.check(hole(1, int(6)), assignment).tag).toBe("invalid");
	});

	it("discharges a reflexive equality on an ambient variable while inferring a local predicate", () => {
		const scope = { binders: [binder("x")], premises: [hole(1, x)] };
		const assignment = Horn.solve([
			{ ...scope, goal: gt(x, int(0)) },
			{ ...scope, goal: eq(y, y) },
		]);
		expect(assignment.get(1)?.body).toEqual(gt(x, int(0)));
	});

	it("selects the innermost eligible assumption and projects a fresh alias", () => {
		const scope = { binders: [binder("x"), binder("y")], premises: [hole(1, x), hole(2, x), hole(3, y), eq(y, x)] };
		const assignment = Horn.solve([{ ...scope, goal: gt(x, int(0), "argument") }]);
		expect(assignment.get(2)?.body).toEqual(gt(x, int(0), "argument"));
		expect(assignment.get(1)?.body).toEqual(DSL.T);
		expect(assignment.get(3)?.body).toEqual(DSL.T);
	});

	it("keeps dependent premises and independent callback goals open", () => {
		const binders = [binder("x")];
		const assignment = Horn.solve([
			{ binders, premises: [hole(1, x)], goal: hole(2, x) },
			{ binders, premises: [hole(2, x)], goal: gt(x, int(0)) },
			{ binders: [], premises: [], goal: hole(3, int(1)) },
		]);
		expect([...assignment.keys()]).toEqual([2]);
		expect(assignment.get(2)?.body).toEqual(gt(x, int(0)));
		expect(Validity.check(hole(3, int(1)), assignment).tag).toBe("unknown");
	});

	it("recognizes reflexive goals and guards from different source locations", () => {
		const scope = { binders: [binder("x")], premises: [hole(1, x), DSL.not(gt(x, int(0), "premise comparison"), "premise")] };
		const assignment = Horn.solve([
			{ ...scope, goal: hole(1, x) },
			{ ...scope, goal: DSL.not(gt(x, int(0), "goal comparison"), "goal") },
			{ binders: [], premises: [], goal: hole(1, int(1)) },
		]);
		expect(assignment.size).toBe(0);
	});

	it.each([
		{ binders: [binder("x")], premises: [hole(1, x, x)], goal: gt(x, int(0)) },
		{ binders: [binder("x")], premises: [hole(1, int(0))], goal: gt(x, int(0)) },
		{ binders: [binder("x"), binder("x")], premises: [hole(1, x)], goal: gt(x, int(0)) },
		{ binders: [binder("x"), binder("y")], premises: [hole(1, x), gt(y, int(0))], goal: lt(x, int(1)) },
		{ binders: [binder("x")], premises: [hole(1, x)], goal: Build.exists([{ name: "y", sort: Build.Int }], gt(y, x)) },
		{ binders: [binder("x")], premises: [hole(1, x)], goal: DSL.not(hole(1, int(0))) },
	])("leaves a requirement outside the direct fragment open: $goal.tag", constraint => {
		expect(Horn.solve([constraint]).size).toBe(0);
	});
});
