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
		["relay", "valid"],
		["localRelay", "valid"],
		["declared", "invalid"],
		["withConfig", "unknown"],
	] as const)("checks %s using its inferred Yap predicates", (name, verdict) => {
		const declaration = elaborateModule(source).declarations.find(d => d.name === name);
		assert(declaration?.elaborated, declaration?.error);
		const { tm, ty, ctx, registry } = declaration.elaborated;
		const result = VerificationServiceV2().letdec(name, tm, ty, ctx, registry);
		assert(!Eff.failed(result.answer));
		expect(Validity.check(result.answer.vc, result.assignment).tag).toBe(verdict);
		const solved = Object.values(result.registry).filter(p => p.kind === "Predicate" && p.solution);

		if (verdict === "valid") {
			expect(solved.map(p => p.solution)).toMatchObject([{ type: "Abs" }, { type: "Abs" }]);
			return;
		}
		expect(solved).toEqual([]);
	});

	it.each([
		[String.raw`with Fetch: (\p k -> k 3) in`, "valid"],
		[String.raw`with Tell: (\p k -> k 3) in`, "invalid"],
		["", "invalid"],
	])("applies the local relay contract in the handler scope %s", (handler, expected) => {
		const program = String.raw`
			foreign Fetch: Effect String (Num [| \v -> true |]);
			foreign Tell: Effect String (Num [| \v -> true |]);
			let fetch: (s |- x: String [| \v -> live s Fetch |]) -> Num = \x -> suspend @Fetch x;
			let result = ${handler} { let relay = \key -> fetch key; return relay "foo"; };
		`;
		const declaration = elaborateModule(program).declarations.at(-1);
		assert(declaration?.elaborated, declaration?.error);
		const { tm, ty, ctx, registry } = declaration.elaborated;
		const result = VerificationServiceV2().letdec("result", tm, ty, ctx, registry);
		assert(!Eff.failed(result.answer));
		expect(Validity.check(result.answer.vc, result.assignment).tag).toBe(expected);
	});
});
