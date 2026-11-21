import assert from "node:assert";
import { describe, expect, it } from "vitest";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import { defaultContext } from "@yap/shared/lib/constants";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { hypotheses, run, VC } from "../V2/effects";
import { solution } from "../V2/binding";
import { VerificationServiceV2 } from "../V2/service";
import * as Horn from "../horn";
import { Build, DSL } from "../solver/ivl";
import { Validity } from "../validity";

const source = String.raw`
foreign Fetch: Effect String Num;
let fetch: (st |- key: String [| \v -> live st Fetch |]) -> Num = \key -> suspend @Fetch key;
let relay = \key -> fetch key;
let localRelay = \key -> { let unused: Num = unused; return fetch key; };
let declared: String -> Num = \key -> fetch key;
let withConfig: (get: String -> Num) -> Num = \get -> get "config";
`;

describe("Deferred verification constraints", () => {
	it("emits one clause per conjunct and retains each goal’s diagnostic origin", () => {
		const lower = DSL.gt(DSL.x, DSL.int(0));
		const upper = DSL.lt(DSL.x, DSL.int(10), "upper bound");
		const goal = Build.andWithOrigin([lower, upper], "range");
		const binder = { name: "x", sort: Build.Int };
		const predicate = DSL.eq(Build.hole(1, [DSL.x]), Build.bool(true));
		const guard = DSL.gt(DSL.x, DSL.int(-1));
		const applied = DSL.eq(Build.hole(2, [DSL.int(1)]), Build.bool(true));
		const premise = Build.and(predicate, guard, applied);
		const { answer, constraints } = run(defaultContext, Metas.empty, () => hypotheses.local(VC.extend({ binder, premise }), VC.require(goal)));
		expect(answer).toBe(goal);
		expect(constraints).toEqual([
			{ binders: [binder], assumptions: [{ kappa: 1, params: [binder] }], guards: [guard, applied], goal: { ...lower, origin: "range" } },
			{ binders: [binder], assumptions: [{ kappa: 1, params: [binder] }], guards: [guard, applied], goal: upper },
		]);
	});

	it("returns a false VC for incompatible literal types without inferring a precondition", () => {
		const { answer, constraints } = VerificationServiceV2().subtype(NF.Constructors.Atom("Num"), NF.Constructors.Atom("String"), defaultContext, Metas.empty);
		expect(answer).toEqual(Build.false_());
		expect(constraints).toEqual([]);
	});

	it.each([
		["relay", "unknown", "valid"],
		["localRelay", "unknown", "valid"],
		["declared", "invalid", "invalid"],
		["withConfig", "unknown", "unknown"],
	] as const)("checks %s with its scoped assignment", (name, before, after) => {
		const declaration = elaborateModule(source).declarations.find(d => d.name === name);
		assert(declaration?.elaborated, declaration?.error);
		const { tm, ty, ctx, registry } = declaration.elaborated;
		const { answer, constraints } = VerificationServiceV2().letdec(name, tm, ty, ctx, registry);
		assert(!Eff.failed(answer));
		const assignment = Horn.solve(constraints);
		expect(Validity.check(answer.vc).tag).toBe(before);
		expect(Validity.check(answer.vc, assignment).tag).toBe(after);
		if (after !== "valid") {
			expect(assignment.size).toBe(0);
			return;
		}
		assert(answer.vc.tag === "Forall");
		const [state] = answer.vc.binders;
		const inferred = [...assignment.values()];
		const psi = inferred.find(p => p.params[0]?.name === state.name);
		expect(psi).toMatchObject({
			params: [state],
			body: {
				tag: "Atom",
				op: "=",
				args: [{ tag: "App", head: "$state.live", args: [Build.var_(state.name, state.sort), { tag: "Const", name: "Fetch" }] }, Build.bool(true)],
			},
		});
		expect(inferred.find(p => p.params[0]?.sort.tag === "String")?.body).toEqual(Build.true_());
		expect(assignment.size).toBe(2);
	});
});

describe("Publishing local predicate solutions", () => {
	it.each([
		["Fetch", "valid"],
		["Tell", "invalid"],
		[undefined, "invalid"],
	] as const)("checks relay against the installed identity %s", (effect, expected) => {
		const block = String.raw`{ let relay = \key -> fetch key; return relay "foo"; }`;
		const expression = effect ? String.raw`with ${effect}: (\p k -> k 3) in ${block}` : block;
		const module = elaborateModule(String.raw`
foreign Fetch: Effect String (Num [| \v -> true |]);
foreign Tell: Effect String (Num [| \v -> true |]);
let fetch: (st |- key: String [| \v -> live st Fetch |]) -> Num = \key -> suspend @Fetch key;
let result = ${expression};
`);
		const declaration = module.declarations.find(d => d.name === "result");
		assert(declaration?.elaborated, declaration?.error);
		const { tm, ty, ctx, registry } = declaration.elaborated;
		const { answer, constraints } = VerificationServiceV2().letdec("result", tm, ty, ctx, registry);
		assert(!Eff.failed(answer));
		expect(Validity.check(answer.vc, Horn.solve(constraints)).tag).toBe(expected);
	});

	it("abstracts the selected binder by level and rejects its shadow", () => {
		const binder = { type: "Pi", variable: "x" } as const;
		const ctx = EB.bind(EB.bind(defaultContext, binder, NF.Constructors.Atom("Bool")), binder, NF.Constructors.Atom("Bool"));
		const params = [{ name: "x!0", sort: Build.Bool }];
		const names = new Map([
			[0, "x!0"],
			[1, "x!1"],
		]);
		const quoted = (level: number) =>
			run(defaultContext, Metas.empty, function* () {
				const term = yield* solution(
					{
						params,
						body: Build.atom("=", Build.var_("x!0", Build.Bool), Build.bool(true)),
						parts: [{ params, guards: [], goal: { value: NF.Constructors.Rigid(level), names, ctx } }],
					},
					{ meta: EB.Meta(0, 0), annotation: yield* NF.evaluate(EB.Constructors.Pi("x", "Explicit", EB.DSL.type("Bool"), EB.DSL.type("Bool"))) },
				);
				return term && (yield* NF.quote(0, term));
			}).answer;
		expect(quoted(0)).toMatchObject({ type: "Abs", body: { type: "Var", variable: { type: "Bound", index: 0 } } });
		expect(quoted(1)).toBeUndefined();
	});
});
