import assert from "node:assert";
import { describe, expect, it } from "vitest";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as EB from "@yap/elaboration";
import { defaultContext } from "@yap/shared/lib/constants";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { hypotheses, run, VC } from "../V2/effects";
import { VerificationServiceV2 } from "../V2/service";
import * as Horn from "../horn";
import { Build } from "../solver/ivl";
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
	it("emits each semantic conjunct with the lexical binders at its use", () => {
		const x = NF.Constructors.Rigid(0);
		const zero = NF.Constructors.Lit({ type: "Num", value: 0 });
		const left = NF.DSL.Binop.gt(x, zero),
			right = NF.DSL.Binop.lt(x, zero);
		const goal = NF.DSL.Binop.and(left, right);
		const ctx = EB.bind(defaultContext, { type: "Pi", variable: "x" }, NF.Constructors.Atom("Num"));
		const { answer, constraints } = run(ctx, Metas.empty, () => hypotheses.local(VC.extend({ level: 0 }), VC.require(goal)));
		expect(answer).toMatchObject({ tag: "And" });
		expect(constraints).toMatchObject([
			{ binders: [{ level: 0 }], goal: { name: "$gt" } },
			{ binders: [{ level: 0 }], goal: { name: "$lt" } },
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
		const { answer, constraints, registry: verified } = VerificationServiceV2().letdec(name, tm, ty, ctx, registry);
		assert(!Eff.failed(answer));
		const assignment = Horn.assignment(constraints, ctx, verified);
		expect([...assignment.keys()].every(id => Metas.solution(verified, id) === undefined)).toBe(true);
		expect(Validity.check(answer.vc).tag).toBe(before);
		expect(Validity.check(answer.vc, assignment).tag).toBe(after);
		if (after !== "valid") {
			expect(assignment.size).toBe(0);
			return;
		}
		assert(answer.vc.tag === "Forall");
		const [state] = answer.vc.binders;
		const inferred = [...assignment.values()];
		const psi = inferred.find(p => p.params[0]?.sort.tag === state.sort.tag);
		assert(psi);
		const [formal] = psi.params;
		expect(psi).toMatchObject({
			params: [{ sort: state.sort }],
			body: {
				tag: "Atom",
				op: "=",
				args: [{ tag: "App", head: "$state.live", args: [Build.var_(formal.name, state.sort), { tag: "Const", name: "Fetch" }] }, Build.bool(true)],
			},
		});
		expect(inferred.find(p => p.params[0]?.sort.tag === "String")?.body).toEqual(Build.true_());
		expect(assignment.size).toBe(2);
	});
});
