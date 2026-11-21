import assert from "node:assert";
import { describe, expect, it } from "vitest";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import { defaultContext } from "@yap/shared/lib/constants";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { VC, hypotheses, reader, run, state } from "../V2/effects";
import { infer, VerificationServiceV2 } from "../V2/service";
import * as EB from "@yap/elaboration";
import { Num } from "@yap/shared/literals";
import { OP_LIVE, PrimOps } from "@yap/shared/lib/primitives";
import { condition, hypothesis, scope } from "../V2/logic/translate";
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
	it("emits one native clause per conjunct and retains its lexical premises", () => {
		const { Rigid, Atom, Lit, Flex, App } = NF.Constructors;
		const { and, gt, lt } = NF.DSL.Binop;
		const x = Rigid(0);
		const bound = { name: "x", sort: Build.Real };
		const annotation = Atom("Num");
		const registry = [1, 2].reduce((r, id) => Metas.register(r, { kind: "Predicate", meta: EB.Meta(id, 0), annotation }), Metas.empty);
		const premise = and(App(Flex(EB.Meta(1, 0)), x, "Explicit"), and(gt(x, Lit(Num(-1))), App(Flex(EB.Meta(2, 0)), Lit(Num(1)), "Explicit")));
		const goal = and(gt(x, Lit(Num(0))), lt(x, Lit(Num(10))));
		const { answer, constraints } = run(defaultContext, registry, () =>
			scope(
				"x",
				{ type: "Pi", variable: "x" },
				annotation,
				(function* () {
					const entry = yield* hypothesis(bound, annotation, premise);
					return yield* hypotheses.local(VC.extend(entry), VC.require(yield* condition(goal)));
				})(),
			),
		);
		const v = Build.var_("x", Build.Real);
		expect(answer).toEqual(Build.and(DSL.gt(v, Build.num(0, Build.Real)), DSL.lt(v, Build.num(10, Build.Real))));
		expect(constraints).toHaveLength(2);
		expect(constraints.map(c => c.goal)).toMatchObject([
			{ type: "External", name: "$gt" },
			{ type: "External", name: "$lt" },
		]);
		expect(constraints[0].binders).toMatchObject([{ name: "x", annotation }]);
		expect(constraints[0].premises).toMatchObject([{ type: "External", name: "$and" }]);
		expect(constraints[1].premises).toBe(constraints[0].premises);
	});

	it("emits a false Horn goal for a suspension in the empty state", () => {
		const { answer, constraints } = run(defaultContext, Metas.empty, function* () {
			const unit = NF.Constructors.Atom("Unit");
			const available = PrimOps[OP_LIVE].compute(yield* state.ask(), unit, unit, NF.Constructors.Var({ type: "Foreign", name: "Ask" }));
			return yield* VC.require(yield* condition(available));
		});
		expect(answer).toEqual(Build.false_());
		expect(constraints.map(c => c.goal)).toMatchObject([{ type: "Lit", value: { type: "Bool", value: false } }]);
	});

	it("retains a sibling label's type when a definition leaves the record scope", () => {
		const { Atom, Rigid, Var, Flex, App } = NF.Constructors;
		const num = Atom("Num");
		const x = Rigid(0);
		const registry = Metas.register(Metas.empty, { kind: "Predicate", meta: EB.Meta(1, 0), annotation: num });
		const label = Var({ type: "Label", name: "bound" });
		const { constraints } = run(defaultContext, registry, () =>
			reader.local(
				ctx => ({ ...ctx, labels: { ...ctx.labels, bound: num } }),
				scope(
					"x",
					{ type: "Pi", variable: "x" },
					num,
					(function* () {
						const entry = yield* hypothesis({ name: "x", sort: Build.Real }, num, App(Flex(EB.Meta(1, 0)), x, "Explicit"));
						return yield* hypotheses.local(VC.extend(entry), VC.require(yield* condition(NF.DSL.Binop.gt(x, label))));
					})(),
				),
			),
		);
		expect(infer(constraints, defaultContext, registry).get(1)?.body).toEqual(DSL.gt(Build.var_("x", Build.Real), Build.const_("bound", Build.Real)));
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
		const assignment = infer(constraints, ctx, verified);
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
