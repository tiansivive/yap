import assert from "node:assert";
import { describe, expect, it } from "vitest";
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";
import { defaultContext } from "@yap/shared/lib/constants";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Row from "@yap/shared/rows";
import { elaborateModule } from "../../elaboration/__tests__/module";
import { run } from "../V2/effects";
import { term } from "../V2/logic/translate";
import { subtype } from "../V2/subtype";
import { VerificationServiceV2 } from "../V2/service";
import { Build } from "../solver/ivl/build";
import { Patterns } from "../solver/ivl/patterns";
import type { IVL } from "../solver/ivl/types";
import { ground } from "../solver/v2/quantifier/mbqi/grounding";
import { Validity } from "../validity";

describe("Logical binder identities", () => {
	it("distinguishes repeated names in the initial context", () => {
		const num = NF.Constructors.Lit({ type: "Atom", value: "Num" });
		const ctx = ["x", "x"].reduce((ctx, variable) => EB.bind(ctx, { type: "Pi", variable }, num), defaultContext);
		const { answer } = run(ctx, {}, function* () {
			return [yield* term(NF.Constructors.Rigid(0)), yield* term(NF.Constructors.Rigid(1))];
		});
		assert(!Eff.failed(answer));
		const [outer, inner] = answer;
		expect(Validity.check(Build.atom("=", outer, inner)).tag).toBe("invalid");
		assert(outer.tag === "Var" && inner.tag === "Var");

		expect(outer.name).not.toBe(inner.name);
	});

	it("substitutes a quantified reference in its generated formula", () => {
		const num = NF.Constructors.Lit({ type: "Atom", value: "Num" });
		const ctx = EB.bind(defaultContext, { type: "Pi", variable: "x" }, num);
		const { answer } = run(ctx, {}, () => term(NF.Constructors.Rigid(0)));
		assert(!Eff.failed(answer) && answer.tag === "Var");
		const formula = Build.atom("=", answer, Build.num(0, Build.Real));

		expect(ground(formula, new Map([[answer.name, Build.num(0, Build.Real)]]))).toEqual({ tag: "tautology" });
		expect(ground(formula, new Map([[answer.name, Build.num(1, Build.Real)]]))).toEqual({ tag: "contradiction" });
	});

	it("gives independent type openings fresh identities at the same depth", () => {
		const [{ elaborated, error }] = elaborateModule(String.raw`let identity: (x: Num) -> Num [| \r -> r == x |] = \x -> x;`).declarations;
		assert(elaborated, error);
		const { ctx, registry, ty } = elaborated;
		const { answer } = run(ctx, registry, function* () {
			return [yield* subtype(ty, ty), yield* subtype(ty, ty)];
		});
		assert(!Eff.failed(answer));
		const [first, second] = answer.map(binders);

		expect(first.length).toBeGreaterThan(0);
		expect(first.filter(name => second.includes(name))).toEqual([]);
		answer.forEach(vc => expect(Validity.check(vc).tag).toBe("valid"));
	});

	it("preserves the identities of bound function heads", () => {
		const num = NF.Constructors.Lit({ type: "Atom", value: "Num" });
		const fn = NF.Constructors.Pi("x", "Explicit", num, NF.Constructors.Closure(defaultContext, EB.DSL.type("Num")));
		const ctx = ["f", "f"].reduce((ctx, variable) => EB.bind(ctx, { type: "Pi", variable }, fn), defaultContext);
		const { answer } = run(ctx, {}, function* () {
			return yield* Eff.traverse([0, 1], lvl =>
				term(NF.Constructors.App(NF.Constructors.Rigid(lvl), NF.Constructors.Lit({ type: "Num", value: 1 }), "Explicit")),
			);
		});
		assert(!Eff.failed(answer));
		const [outer, inner] = answer;
		assert(outer.tag === "Select" && inner.tag === "Select" && outer.array.tag === "Var" && inner.array.tag === "Var");

		expect(outer.array.name).not.toBe(inner.array.name);
	});

	it("opens a dependent pattern binder in the scope of its predecessor", () => {
		const num = NF.Constructors.Lit({ type: "Atom", value: "Num" });
		const outer = EB.bind(defaultContext, { type: "Pattern", variable: "a" }, num);
		const dependent = NF.Constructors.Modal(num, {
			quantity: Q.Many,
			liquid: NF.Constructors.Lambda("v", "Explicit", NF.Constructors.Closure(outer, EB.DSL.eq(EB.DSL.bound(0), EB.DSL.bound(1))), num),
		});
		const pattern = EB.Constructors.Patterns.Struct(
			Row.Constructors.Row([
				{ label: "left", value: EB.Constructors.Patterns.Binder("a") },
				{ label: "right", value: EB.Constructors.Patterns.Binder("b") },
			]),
		);
		const scrutinee = EB.DSL.struct([
			{ label: "left", value: EB.DSL.num(0) },
			{ label: "right", value: EB.DSL.num(0) },
		]);
		const tm = EB.Constructors.Match(scrutinee, [
			{
				pattern,
				binders: [
					["a", num],
					["b", dependent],
				],
				term: EB.DSL.bound(0),
			},
		]);
		const { answer } = VerificationServiceV2().check(tm, num, defaultContext, {});
		assert(!Eff.failed(answer));
		assert(answer.vc.tag === "Forall" && answer.vc.body.tag === "Forall");
		const first = answer.vc.body;
		assert(first.body.tag === "Forall");
		const second = first.body;
		assert(second.body.tag === "Implies");

		expect(second.body.left).toEqual(Build.atom("=", Build.var_(second.binders[0].name, Build.Real), Build.var_(first.binders[0].name, Build.Real)));
		expect(Validity.check(answer.vc).tag).toBe("valid");
	});
});

const binders = (formula: IVL.Formula): string[] =>
	match(formula)
		.with(Patterns.Formula.Forall, Patterns.Formula.Exists, ({ binders: bound, body }) => [...bound.map(b => b.name), ...binders(body)])
		.with(Patterns.Formula.And, Patterns.Formula.Or, ({ values }) => values.flatMap(binders))
		.with(Patterns.Formula.Implies, ({ left, right }) => [...binders(left), ...binders(right)])
		.with(Patterns.Formula.Not, ({ value }) => binders(value))
		.otherwise(() => []);
