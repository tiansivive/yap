import assert from "node:assert";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { mkCtx, runNF } from "../../inference/__tests__/util";

const C = EB.Constructors;
const V = NF.Constructors;
const atom = (value: string) => C.Lit({ type: "Atom", value });
const num = (value: number) => C.Lit({ type: "Num", value });
const bound = (index: number) => C.Var(EB.Bound(index));
const app = (func: EB.Term, arg: EB.Term) => C.App("Explicit", func, arg);
const lambda = (name: string, body: EB.Term) => C.Lambda(name, "Explicit", body, atom("Num"));
const add = (left: EB.Term, right: EB.Term) => app(app(C.Var(C.Vars.Foreign("$add")), left), right);
const doubled = (index: number) => app(lambda("x", add(bound(0), bound(0))), app(bound(index), num(5)));
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
		const term = app(lambda("x", num(7)), app(bound(0), num(5)));
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
		const value = evaluate(ctx, app(lambda("x", bound(0)), meta));
		expect(value).toMatchObject({ type: "Neutral", kind: "Symbolic", value: { type: "Var", variable: { type: "Meta", val: 8 } } });
		expect(runNF(ctx, () => NF.quote(0, value))).toMatchObject({ type: "Var", variable: { type: "Meta", val: 8 } });
	});

	it("reduces a function that discards a symbolic variable", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "g" }, NF.Any);
		expect(evaluate(ctx, app(lambda("x", num(7)), bound(0)))).toMatchObject({ type: "Lit", value: { value: 7 } });
	});

	it.each([
		["a shared blocked result", doubled(0), [5]],
		["an eliminated concrete parameter", app(lambda("z", doubled(1)), num(0)), [5]],
		["an enclosing symbolic argument", app(lambda("z", doubled(1)), bound(0)), [5]],
		[
			"a captured closure using a retained argument",
			app(lambda("k", app(lambda("z", app(bound(1), app(bound(2), num(5)))), bound(1))), lambda("x", add(bound(0), bound(0)))),
			[5],
		],
		["a captured closure ignoring its concrete argument", app(lambda("k", app(lambda("z", app(bound(1), num(0))), bound(1))), lambda("x", doubled(1))), [5]],
		[
			"a captured closure under an outer retained call",
			app(lambda("k", app(lambda("z", app(bound(1), app(bound(2), num(5)))), app(bound(1), num(1)))), lambda("x", add(bound(0), bound(0)))),
			[1, 5],
		],
		[
			"a captured closure receiving a concrete argument under an outer retained call",
			app(lambda("k", app(lambda("z", app(bound(1), num(0))), app(bound(1), num(1)))), lambda("x", doubled(1))),
			[1, 5],
		],
		["an existing existential argument", app(lambda("x", doubled(1)), app(lambda("z", num(0)), app(bound(0), num(1)))), [1, 5]],
		["an existing existential function", app(app(lambda("x", lambda("y", doubled(2))), app(bound(0), num(1))), num(0)), [1, 5]],
	] as const)("shares g 5 through %s", (_, term, calls) => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "g" }, evaluate(mkCtx(), C.Pi("n", "Explicit", atom("Num"), atom("Num"))));
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
		const value = evaluate(ctx, lambda("y", doubled(1)));
		const quoted = runNF(ctx, () => NF.quote(1, value));
		expect(quoted).toMatchObject({ type: "Abs", body: { type: "Block", statements: [{ type: "Let", variable: "$r2" }] } });
		const compute = vi.fn(() => V.Lit({ type: "Num", value: 9 }));
		const resolved = { ...ctx, env: [{ ...ctx.env[0], nf: V.External("$g", 1, compute, []) }] };
		expect(evaluate(resolved, app(quoted, num(0)))).toMatchObject({ type: "Lit", value: { type: "Num", value: 18 } });
		expect(compute).toHaveBeenCalledTimes(1);
	});
});
