import assert from "node:assert";
import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";
import { defaultContext } from "@yap/shared/lib/constants";
import { run } from "../V2/effects";
import { formula, scope, term } from "../V2/logic/translate";
import { Build } from "../solver/ivl/build";

const num = NF.Constructors.Lit({ type: "Atom", value: "Num" });
const literal = (value: number) => NF.Constructors.Lit({ type: "Num", value });
const fn = NF.Constructors.Pi("x", "Explicit", num, NF.Constructors.Closure(defaultContext, EB.DSL.type("Num")));

describe("Retained definitions in translation", () => {
	it("substitutes a symbolic call at each use of its retained result", () => {
		const ctx = EB.bind(defaultContext, { type: "Pi", variable: "f" }, fn);
		const producer = NF.Constructors.App(NF.Constructors.Rigid(0), literal(5), "Explicit");
		const value = retained(ctx, producer, r => NF.DSL.Binop.add(r, r));
		const { answer } = run(ctx, {}, function* () {
			return [yield* term(NF.Constructors.Rigid(0)), yield* term(value)];
		});
		assert(!Eff.failed(answer));
		const [f, actual] = answer;
		const applied = Build.select(f, Build.num(5, Build.Real), Build.Real);

		expect(actual).toEqual(Build.arith("+", applied, applied, Build.Real));
	});

	it("substitutes a retained definition in function position", () => {
		const ctx = EB.bind(defaultContext, { type: "Pi", variable: "f" }, fn);
		const value = retained(ctx, NF.Constructors.Rigid(0), f => NF.Constructors.App(f, literal(5), "Explicit"));
		const { answer } = run(ctx, {}, function* () {
			return [yield* term(NF.Constructors.Rigid(0)), yield* term(value)];
		});
		assert(!Eff.failed(answer));
		const [f, actual] = answer;

		expect(actual).toEqual(Build.select(f, Build.num(5, Build.Real), Build.Real));
	});

	it("composes nested definitions and restores sibling environments", () => {
		const ctx = EB.bind(defaultContext, { type: "Pi", variable: "x" }, num);
		const value = (amount: number) =>
			retained(ctx, NF.DSL.Binop.add(NF.Constructors.Rigid(0), literal(1)), (r, inner) =>
				retained(inner, NF.DSL.Binop.add(r, literal(amount)), s => NF.DSL.Binop.eq(s, r)),
			);
		const { answer } = run(ctx, {}, function* () {
			return {
				x: yield* term(NF.Constructors.Rigid(0)),
				first: yield* formula(value(2)),
				second: yield* formula(value(3)),
				ordinary: yield* scope("ordinary", { type: "Pi", variable: "ordinary" }, num, term(NF.Constructors.Rigid(1))),
			};
		});
		assert(!Eff.failed(answer));
		const r = Build.arith("+", answer.x, Build.num(1, Build.Real), Build.Real);

		expect(answer.first).toEqual(Build.atom("=", Build.arith("+", r, Build.num(2, Build.Real), Build.Real), r));
		expect(answer.second).toEqual(Build.atom("=", Build.arith("+", r, Build.num(3, Build.Real), Build.Real), r));
		expect(answer.ordinary).toEqual(Build.var_("ordinary", Build.Real));
	});
});

const retained = (ctx: EB.Context, producer: NF.Value, body: (result: NF.Value, ctx: EB.Context) => NF.Value): NF.Value => {
	const variable: Extract<NF.Variable, { type: "Bound" }> = { type: "Bound", lvl: ctx.env.length };
	const result = NF.Constructors.Rigid(variable.lvl);
	const inner = EB.extend(ctx, { type: "Let", variable: "r" }, result);
	return NF.Constructors.Exists("r", NF.Irrelevant, { ctx: inner, value: body(result, inner) }, new Map([[variable, producer]]));
};
