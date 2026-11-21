import assert from "node:assert";
import { describe, expect, it } from "vitest";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { mkCtx } from "../../elaboration/inference/__tests__/util";
import { run } from "../V2/effects";
import { scope, term } from "../V2/logic/translate";
import { VerificationServiceV2 } from "../V2/service";
import { Build, Print } from "../solver/ivl";
import { Solver } from "../solver/v2/solver";
import { Validity } from "../validity";

describe("Open predicate translation", () => {
	it("keeps a predicate's ordered spine inside an ordinary application", () => {
		const ctx = mkCtx();
		const { answer } = run(ctx, {}, function* () {
			const bool = EB.DSL.type("Bool");
			const unary = EB.Constructors.Pi("x", "Explicit", bool, bool);
			const binary = EB.Constructors.Pi("y", "Explicit", bool, unary);
			const predicate = yield* EB.freshMeta(ctx.env.length, yield* NF.evaluate(binary), "Predicate");
			const first = yield* NF.reduce(NF.Constructors.Flex(predicate), yield* NF.evaluate(EB.DSL.bool(true)), "Explicit");
			const applied = yield* NF.reduce(first, yield* NF.evaluate(EB.DSL.bool(false)), "Explicit");
			const f = NF.Constructors.Rigid(ctx.env.length);
			const result = yield* scope("f", { type: "Pi", variable: "f" }, yield* NF.evaluate(unary), term(NF.Constructors.App(f, applied, "Explicit")));
			return { result, predicate };
		});
		assert(!Eff.failed(answer));
		const { result, predicate } = answer;
		expect(result).toEqual(
			Build.select(Build.var_("f", Build.fn([Build.Bool], Build.Bool)), Build.hole(predicate.val, [Build.bool(true), Build.bool(false)]), Build.Bool),
		);
	});

	it("reports the blocking predicate when the concrete solver receives an open formula", () => {
		const predicateId = 7;
		const hole = Build.hole(predicateId, [Build.bool(false)]);
		const x = Build.var_("x", Build.Bool);
		const open = Build.atom("=", x, hole);
		const row = Build.row(Build.rowExtend("field", Build.prop(open), Build.rowEmpty), Build.Row);
		const nested = Build.atom("=", Build.app("f", [row], Build.Bool), x);
		expect(Solver.check(nested)).toEqual({ tag: "unknown", reason: `Unsolved predicate ?${predicateId}` });
	});

	it.each([
		[NF.Constructors.External("test", 1, () => NF.Type, []), /External "test" requires external translation/],
		[NF.Constructors.Var({ type: "Label", name: "field" }), /Unsupported Label variable "field"/],
		[NF.Constructors.Flex(EB.Meta(120, 0)), /unregistered meta \?120/],
	] as const)("reports the unsupported application head (%#)", (head, diagnostic) => {
		expect(() => run(mkCtx(), {}, () => term(NF.Constructors.App(head, NF.Type, "Explicit")))).toThrow(diagnostic);
	});

	it("keeps both callback calls under their literal guards", () => {
		const [declaration] = elaborateModule(String.raw`let twice: (get: String -> Num) -> Num = \get -> (get "alpha") + (get "beta");`).declarations;
		assert(declaration.elaborated, declaration.error);
		const { tm, ty, ctx, registry } = declaration.elaborated;
		const { answer } = VerificationServiceV2().letdec("twice", tm, ty, ctx, registry);
		assert(!Eff.failed(answer) && answer.vc.tag === "Forall" && answer.vc.body.tag === "And");
		const uses = answer.vc.body.values.flatMap(clause => {
			assert(clause.tag === "Forall" && clause.body.tag === "Implies");
			const { left, right } = clause.body;
			assert(left.tag === "Atom" && right.tag === "Atom");
			const [bound, argument] = left.args;
			if (argument.tag !== "Str") {
				return [];
			}
			const [predicate] = right.args;
			assert(bound.tag === "Var" && predicate.tag === "Hole");
			expect(clause.binders[0].name).toBe(bound.name);
			expect(predicate.spine).toEqual([bound]);
			expect(Print.term(predicate)).toBe(`κ${predicate.kappa}(${bound.name})`);
			return [{ argument: argument.value, binder: bound.name, kappa: predicate.kappa }];
		});
		expect(uses.map(use => use.argument)).toEqual(["alpha", "beta"]);
		expect(uses[0].kappa).toBe(uses[1].kappa);
		expect(uses[0].binder).not.toBe(uses[1].binder);
		expect(Validity.check(answer.vc).tag).toBe("unknown");
	});
});
