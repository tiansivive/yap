import assert from "node:assert";
import { describe, expect, it } from "vitest";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { VerificationServiceV2 } from "../V2/service";
import { Horn } from "../horn";
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
