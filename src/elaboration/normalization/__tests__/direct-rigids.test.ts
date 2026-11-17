import assert from "node:assert";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { mkCtx, runNF } from "../../inference/__tests__/util";

const C = EB.Constructors;
const V = NF.Constructors;
const D = EB.DSL;
const doubled = (index: number) => D.app(D.lambda("x", D.add(D.bound(0), D.bound(0)), D.type("Num")), D.app(D.bound(index), D.num(5)));
const evaluate = (ctx: EB.Context, term: EB.Term) => runNF(ctx, () => NF.evaluate(term));
const levels = (value: NF.Value): number[] =>
	match(value)
		.with({ type: "Existential" }, ({ assumptions, body }) => [...assumptions.keys()].map(variable => variable.lvl).concat(levels(body.value)))
		.otherwise(() => []);

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("retained rigid scopes", () => {
	it("retains an ignored call with an irrelevant result annotation", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "g" }, NF.Any);
		const term = D.app(D.lambda("x", D.num(7), D.type("Num")), D.app(D.bound(0), D.num(5)));
		const value = evaluate(ctx, term);
		assert(value.type === "Existential");
		expect(value).toMatchObject({ annotation: NF.Irrelevant, body: { value: { type: "Lit", value: { value: 7 } } } });
		expect([...value.assumptions.keys()]).toEqual([{ type: "Bound", lvl: 1 }]);
		const quoted = runNF(ctx, () => NF.quote(ctx.env.length, value));
		expect(quoted).toMatchObject({ type: "Block", statements: [{ type: "Let", annotation: NF.Irrelevant }] });
		const compute = vi.fn(() => V.Lit({ type: "Num", value: 9 }));
		const resolved = { ...ctx, env: [{ ...ctx.env[0], nf: V.External("$g", 1, compute, []) }] };
		expect(evaluate(resolved, quoted)).toMatchObject({ type: "Lit", value: { value: 7 } });
		expect(compute).toHaveBeenCalledTimes(1);
	});

	it("passes a symbolic meta through its existing Core reference", () => {
		const ctx = mkCtx();
		const meta = C.Var({ type: "Meta", val: 8, lvl: 0 });
		const value = evaluate(ctx, D.app(D.lambda("x", D.bound(0), D.type("Num")), meta));
		expect(value).toMatchObject({ type: "Neutral", kind: "Symbolic", value: { type: "Var", variable: { type: "Meta", val: 8 } } });
		expect(runNF(ctx, () => NF.quote(0, value))).toMatchObject({ type: "Var", variable: { type: "Meta", val: 8 } });
	});

	it("reduces a function that discards a symbolic variable", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "g" }, NF.Any);
		expect(evaluate(ctx, D.app(D.lambda("x", D.num(7), D.type("Num")), D.bound(0)))).toMatchObject({ type: "Lit", value: { value: 7 } });
	});

	it.each([
		["a shared blocked result", doubled(0), [5]],
		["an eliminated concrete parameter", D.app(D.lambda("z", doubled(1), D.type("Num")), D.num(0)), [5]],
		["an enclosing symbolic argument", D.app(D.lambda("z", doubled(1), D.type("Num")), D.bound(0)), [5]],
		[
			"a captured closure using a retained argument",
			D.app(
				D.lambda("k", D.app(D.lambda("z", D.app(D.bound(1), D.app(D.bound(2), D.num(5))), D.type("Num")), D.bound(1)), D.type("Num")),
				D.lambda("x", D.add(D.bound(0), D.bound(0)), D.type("Num")),
			),
			[5],
		],
		[
			"a captured closure ignoring its concrete argument",
			D.app(
				D.lambda("k", D.app(D.lambda("z", D.app(D.bound(1), D.num(0)), D.type("Num")), D.bound(1)), D.type("Num")),
				D.lambda("x", doubled(1), D.type("Num")),
			),
			[5],
		],
		[
			"a captured closure under an outer retained call",
			D.app(
				D.lambda("k", D.app(D.lambda("z", D.app(D.bound(1), D.app(D.bound(2), D.num(5))), D.type("Num")), D.app(D.bound(1), D.num(1))), D.type("Num")),
				D.lambda("x", D.add(D.bound(0), D.bound(0)), D.type("Num")),
			),
			[1, 5],
		],
		[
			"a captured closure receiving a concrete argument under an outer retained call",
			D.app(
				D.lambda("k", D.app(D.lambda("z", D.app(D.bound(1), D.num(0)), D.type("Num")), D.app(D.bound(1), D.num(1))), D.type("Num")),
				D.lambda("x", doubled(1), D.type("Num")),
			),
			[1, 5],
		],
		[
			"an existing existential argument",
			D.app(D.lambda("x", doubled(1), D.type("Num")), D.app(D.lambda("z", D.num(0), D.type("Num")), D.app(D.bound(0), D.num(1)))),
			[1, 5],
		],
		[
			"an existing existential function",
			D.app(D.app(D.lambda("x", D.lambda("y", doubled(2), D.type("Num")), D.type("Num")), D.app(D.bound(0), D.num(1))), D.num(0)),
			[1, 5],
		],
	] as const)("shares g 5 through %s", (_, term, calls) => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "g" }, evaluate(mkCtx(), C.Pi("n", "Explicit", D.type("Num"), D.type("Num"))));
		const value = evaluate(ctx, term);
		assert(value.type === "Existential");
		const retained = levels(value);
		expect(retained).toEqual(calls.map((_, index) => ctx.env.length + index));
		const quoted = runNF(ctx, () => NF.quote(ctx.env.length, value));
		const compute = vi.fn(() => V.Lit({ type: "Num", value: 9 }));
		const resolved = { ...ctx, env: [{ ...ctx.env[0], nf: V.External("$g", 1, compute, []) }] };

		expect(evaluate(resolved, quoted)).toMatchObject({ type: "Lit", value: { type: "Num", value: 18 } });
		expect(compute.mock.calls).toEqual(calls.map(value => [expect.objectContaining({ type: "Lit", value: { type: "Num", value } })]));
	});

	it("allocates a retained result after the binder opened by quotation", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "g" }, NF.Any);
		const value = evaluate(ctx, D.lambda("y", doubled(1), D.type("Num")));
		const quoted = runNF(ctx, () => NF.quote(1, value));
		expect(quoted).toMatchObject({ type: "Abs", body: { type: "Block", statements: [{ type: "Let", variable: "$r2" }] } });
		const compute = vi.fn(() => V.Lit({ type: "Num", value: 9 }));
		const resolved = { ...ctx, env: [{ ...ctx.env[0], nf: V.External("$g", 1, compute, []) }] };
		expect(evaluate(resolved, D.app(quoted, D.num(0)))).toMatchObject({ type: "Lit", value: { type: "Num", value: 18 } });
		expect(compute).toHaveBeenCalledTimes(1);
	});
});
