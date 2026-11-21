import assert from "node:assert";
import { describe, expect, it } from "vitest";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { VerificationServiceV2 } from "../V2/service";
import { Horn } from "../horn";
import { Build, DSL, type IVL } from "../solver/ivl";
import { Validity } from "../validity";

describe("Direct Horn preconditions", () => {
	it.each([
		["relay", "valid"],
		["declared", "invalid"],
		["withConfig", "unknown"],
	] as const)("checks %s after local inference", (name, verdict) => {
		const source = String.raw`
foreign Fetch: Effect String Num;
foreign fetch: (st |- key: String [| \v -> live st Fetch |]) -> Num;
let relay = \key -> fetch key;
let declared: String -> Num = \key -> fetch key;
let withConfig: (get: String -> Num) -> Num = \get -> get "config";
`;
		const declaration = elaborateModule(source).declarations.find(d => d.name === name);
		assert(declaration?.elaborated, declaration?.error);
		const { tm, ty, ctx, registry } = declaration.elaborated;
		const { answer } = VerificationServiceV2().letdec(name, tm, ty, ctx, registry);
		assert(!Eff.failed(answer));
		const { formula, assignment } = Horn.infer(answer.vc);
		expect(Validity.check(formula).tag).toBe(verdict);
		if (name !== "relay") {
			expect(assignment.size).toBe(0);
			expect(formula).toBe(answer.vc);
			return;
		}

		assert(answer.vc.tag === "Forall");
		const [state] = answer.vc.binders;
		const definitions = [...assignment.values()];
		const precondition = definitions.find(d => d.params[0].name === state.name);
		assert(precondition);
		expect(precondition.params).toEqual([state]);
		expect(precondition.body).toMatchObject({
			tag: "Atom",
			op: "=",
			args: [{ tag: "App", head: "$state.live", args: [Build.var_(state.name, state.sort), { tag: "Const", name: "Fetch" }] }, Build.bool(true)],
		});
		expect(definitions.find(d => d.params[0].sort.tag === "String")?.body).toEqual(Build.true_());
		expect(assignment.size).toBe(2);
	});

	const { x, y, and, eq, forall, gt, implies, int, lt } = DSL;
	const binder = (name: string) => ({ name, sort: Build.Int });
	const hole = (k: number, ...args: IVL.Term[]) => eq(Build.hole(k, args), Build.bool(true));

	it("conjoins requirements under the selected formals and applies them at both uses", () => {
		const first = forall([binder("x")], implies(hole(2, x), implies(gt(x, int(0)), lt(x, int(10)))));
		const second = forall([binder("y")], implies(hole(2, y), gt(y, int(-5))));
		const { assignment, formula } = Horn.infer(and(first, second));
		expect(assignment.get(2)).toEqual({ params: [binder("x")], body: and(implies(gt(x, int(0)), lt(x, int(10))), gt(x, int(-5))) });
		expect(Validity.check(formula).tag).toBe("valid");
	});

	it("selects the innermost precondition covering the goal", () => {
		const vc = forall([binder("x")], implies(hole(1, x), implies(hole(2, x), gt(x, int(0)))));
		const { assignment } = Horn.infer(vc);
		expect(assignment.get(1)?.body).toEqual(DSL.T);
		expect(assignment.get(2)?.body).toEqual(gt(x, int(0)));
	});

	it("carries the enclosing origin to the definition and the occurrence origin to the applied formula", () => {
		const definition = forall([binder("x")], implies(hole(1, x), gt(x, int(0))), "body");
		const argument = Build.const_("argument", Build.Int);
		const occurrence = Build.atom("=", Build.hole(1, [argument]), Build.bool(true), "call");
		const { formula, assignment } = Horn.infer(and(definition, occurrence));
		expect(assignment.get(1)?.body.origin).toBe("body");
		assert(formula.tag === "And");
		expect(formula.values[1]).toEqual(gt(argument, int(0), "call"));
	});

	it.each([
		[1, "valid"],
		[0, "invalid"],
	] as const)("checks the inferred predicate at %i", (argument, verdict) => {
		const definition = forall([binder("x")], implies(hole(1, x), gt(x, int(0))));
		const { formula, assignment } = Horn.infer(and(definition, hole(1, int(argument))));
		expect(assignment.get(1)?.body).toEqual(gt(x, int(0)));
		expect(Validity.check(formula).tag).toBe(verdict);
	});

	it("leaves an independent callback goal open alongside a solved input", () => {
		const guard = DSL.not(DSL.or(eq(x, int(2)), eq(x, int(3))));
		const definition = forall([binder("x")], implies(and(hole(1, x), guard), gt(x, int(0))));
		const { formula, assignment } = Horn.infer(and(definition, hole(2, int(1))));
		expect(assignment.get(1)?.body).toEqual(implies(guard, gt(x, int(0))));
		expect(assignment.has(2)).toBe(false);
		expect(Validity.check(formula).tag).toBe("unknown");
	});

	it("keeps a predicate dependency open while checking the independent concrete definition", () => {
		const vc = forall([binder("x")], and(implies(hole(1, x), hole(2, x)), implies(hole(2, x), gt(x, int(0)))));
		const { formula, assignment } = Horn.infer(vc);
		expect(assignment.has(1)).toBe(false);
		expect(assignment.get(2)?.body).toEqual(gt(x, int(0)));
		expect(Validity.check(formula).tag).toBe("unknown");
	});

	it("recognizes a repeated guard from a different source location", () => {
		const guard = DSL.not(gt(x, int(0), "guard comparison"), "guard");
		const goal = DSL.not(gt(x, int(0), "goal comparison"), "goal");
		const vc = and(forall([binder("x")], implies(and(hole(1, x), guard), goal)), hole(1, int(0)));
		const { formula, assignment } = Horn.infer(vc);
		expect(assignment.size).toBe(0);
		expect(formula).toBe(vc);
	});

	it.each([
		["a guard outside the spine", forall([binder("x"), binder("y")], implies(and(hole(1, x), gt(y, int(0))), gt(x, int(0))))],
		["a shadowed binder", forall([binder("x")], implies(hole(1, x), forall([binder("x")], gt(x, int(0)))))],
		["a negative goal with only a reflexive assumption", and(forall([binder("x")], implies(hole(1, x), hole(1, x))), DSL.not(hole(1, int(0))))],
		["a positive goal with only a reflexive assumption", forall([binder("x")], and(implies(hole(1, x), hole(1, x)), hole(1, x)))],
	] as const)("keeps %s open", (_description, vc) => {
		const { formula, assignment } = Horn.infer(vc);
		expect(assignment.size).toBe(0);
		expect(formula).toBe(vc);
	});
});
