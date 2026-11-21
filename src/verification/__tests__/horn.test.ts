import { describe, expect, it } from "vitest";
import { Horn } from "../horn";
import { Build, DSL, type IVL } from "../solver/ivl";
import { Validity } from "../validity";

const { and, eq, gt, int, lt, x, y } = DSL;
const forall = (name: string): Horn.Frame => ({ tag: "forall", binder: { name, sort: Build.Int } });
const assume = (predicate: IVL.Formula): Horn.Frame => ({ tag: "assume", predicate });
const hole = (id: IVL.Kappa, ...args: IVL.Term[]) => eq(Build.hole(id, args), Build.bool(true));

describe("Solving emitted Horn constraints", () => {
	it("accumulates conjuncts and guards under one set of formal parameters", () => {
		const scope = [forall("x"), assume(hole(1, x))];
		const guarded = [forall("y"), assume(and(hole(1, y), gt(y, int(2))))];
		const assignment = Horn.solve([
			{ scope, goal: and(gt(x, int(0)), lt(x, int(10))) },
			{ scope: guarded, goal: lt(y, int(5)) },
		]);
		expect(assignment.get(1)).toEqual({
			params: [{ name: "x", sort: Build.Int }],
			body: and(gt(x, int(0)), lt(x, int(10)), DSL.implies(gt(x, int(2)), lt(x, int(5)))),
		});
		expect(Validity.check(hole(1, int(1)), assignment).tag).toBe("valid");
		expect(Validity.check(hole(1, int(6)), assignment).tag).toBe("invalid");
	});

	it("discharges a reflexive equality on an ambient variable while inferring a local predicate", () => {
		const scope = [forall("x"), assume(hole(1, x))];
		const assignment = Horn.solve([{ scope, goal: and(gt(x, int(0)), eq(y, y)) }]);
		expect(assignment.get(1)?.body).toEqual(gt(x, int(0)));
	});

	it("selects the innermost eligible assumption and projects a fresh alias", () => {
		const scope = [forall("x"), assume(hole(1, x)), assume(hole(2, x)), forall("y"), assume(and(hole(3, y), eq(y, x)))];
		const assignment = Horn.solve([{ scope, goal: gt(x, int(0)), origin: "argument" }]);
		expect(assignment.get(2)?.body).toEqual(gt(x, int(0), "argument"));
		expect(assignment.get(1)?.body).toEqual(DSL.T);
		expect(assignment.get(3)?.body).toEqual(DSL.T);
	});

	it("keeps dependent premises and independent callback goals open", () => {
		const scope = [forall("x")];
		const assignment = Horn.solve([
			{ scope: [...scope, assume(hole(1, x))], goal: hole(2, x) },
			{ scope: [...scope, assume(hole(2, x))], goal: gt(x, int(0)) },
			{ scope: [], goal: hole(3, int(1)) },
		]);
		expect([...assignment.keys()]).toEqual([2]);
		expect(assignment.get(2)?.body).toEqual(gt(x, int(0)));
		expect(Validity.check(hole(3, int(1)), assignment).tag).toBe("unknown");
	});

	it("recognizes reflexive goals and guards from different source locations", () => {
		const scope = [forall("x"), assume(hole(1, x)), assume(DSL.not(gt(x, int(0), "premise comparison"), "premise"))];
		const assignment = Horn.solve([
			{ scope, goal: and(hole(1, x), DSL.not(gt(x, int(0), "goal comparison"), "goal")) },
			{ scope: [], goal: hole(1, int(1)) },
		]);
		expect(assignment.size).toBe(0);
	});

	it.each([
		{ scope: [forall("x"), assume(hole(1, x)), forall("x")], goal: gt(x, int(0)) },
		{ scope: [forall("x"), assume(hole(1, x)), forall("y"), assume(gt(y, int(0)))], goal: lt(x, int(1)) },
		{ scope: [forall("x"), assume(hole(1, x))], goal: Build.exists([{ name: "y", sort: Build.Int }], gt(y, x)) },
		{ scope: [forall("x"), assume(hole(1, x))], goal: DSL.not(hole(1, int(0))) },
	])("leaves a requirement outside the direct fragment open: $goal.tag", constraint => {
		expect(Horn.solve([constraint]).size).toBe(0);
	});
});
