import assert from "node:assert";
import { describe, expect, it } from "vitest";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Eff from "@yap/utils/effects";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { mkCtx } from "../../elaboration/inference/__tests__/util";
import { run } from "../V2/effects";
import { force, scope, term } from "../V2/logic/translate";
import { VerificationServiceV2 } from "../V2/service";
import { Build, Print } from "../solver/ivl";
import { Solver } from "../solver/v2/solver";
import { Validity } from "../validity";

describe("Open predicate translation", () => {
	it("forces each application against its own binder and the current registry", () => {
		const ctx = mkCtx();
		const { answer } = run(ctx, {}, function* () {
			const bool = yield* NF.evaluate(EB.DSL.type("Bool"));
			const predicate = yield* EB.Liquid.hole(bool);
			const fn = NF.Constructors.Flex(predicate);
			const apply = function* (value: NF.Value) {
				return yield* term(yield* NF.reduce(fn, value, "Explicit"));
			};
			const bound = yield* scope("local!1", { type: "Pi", variable: "local" }, bool, apply(NF.Constructors.Rigid(ctx.env.length)));
			const literal = yield* apply(NF.Constructors.Lit({ type: "Bool", value: false }));
			assert(bound.tag === "Hole" && literal.tag === "Hole");
			expect(bound.head).toEqual([predicate]);
			expect(literal.head).toEqual([predicate]);
			expect(Print.term(bound)).toBe(`?(hole: (?${predicate.val}) local!1)`);
			const identity = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure(ctx, EB.DSL.bound(0)), bool);
			yield* Metas.registry.modify(registry => Metas.solve(registry, predicate.val, identity));
			return [yield* force(bound), yield* force(literal)];
		});
		expect(answer).toEqual([Build.var_("local!1", Build.Bool), Build.bool(false)]);
	});

	it("reports the blocking predicate when the concrete solver receives an open formula", () => {
		const { answer: hole } = run(mkCtx(), {}, function* () {
			const meta = yield* EB.Liquid.hole(NF.Type);
			return yield* term(NF.Constructors.Flex(meta));
		});
		assert(!Eff.failed(hole) && hole.tag === "Hole");
		const x = Build.var_("x", Build.Bool);
		const open = Build.atom("=", x, hole);
		const row = Build.row(Build.rowExtend("field", Build.prop(open), Build.rowEmpty), Build.Row);
		const nested = Build.atom("=", Build.app("f", [row], Build.Bool), x);
		expect(Solver.check(nested)).toEqual({ tag: "unknown", reason: `Unsolved predicate ?${hole.head[0].val}` });
	});

	it.each([
		[NF.Constructors.External("test", 1, () => NF.Type, []), /External "test" requires external translation/],
		[NF.Constructors.Var({ type: "Label", name: "field" }), /Unsupported Label variable "field"/],
		[NF.Constructors.Flex(EB.Meta(120, 0)), /unregistered meta \?120/],
	] as const)("reports the unsupported application head (%#)", (head, diagnostic) => {
		expect(() => run(mkCtx(), {}, () => term(NF.Constructors.App(head, NF.Type, "Explicit")))).toThrow(diagnostic);
	});

	it("retains a type argument until the predicate can reduce", () => {
		const ctx = mkCtx();
		const { answer } = run(ctx, {}, function* () {
			const predicate = yield* EB.Liquid.hole(NF.Type);
			const num = EB.DSL.type("Num");
			const arrow = yield* NF.evaluate(EB.Constructors.Pi("x", "Explicit", num, num));
			const applied = yield* NF.reduce(NF.Constructors.Flex(predicate), arrow, "Explicit");
			const retained = yield* term(applied);
			assert(retained.tag === "Hole");
			expect(retained.term).toBe(applied);
			const closed = NF.Constructors.Lambda("a", "Explicit", NF.Constructors.Closure(ctx, EB.Constructors.Lit({ type: "Bool", value: true })), NF.Type);
			yield* Metas.registry.modify(registry => Metas.solve(registry, predicate.val, closed));
			return yield* force(retained);
		});
		expect(answer).toEqual(Build.bool(true));
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
			expect(Print.term(predicate)).toContain(bound.name);
			return [{ argument: argument.value, head: predicate.head }];
		});
		expect(uses.map(use => use.argument)).toEqual(["alpha", "beta"]);
		expect(uses[0].head).toHaveLength(1);
		expect(uses[0].head).toEqual(uses[1].head);
		expect(Validity.check(answer.vc).tag).toBe("unknown");
	});
});
