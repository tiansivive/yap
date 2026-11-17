import assert from "node:assert";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { mkCtx, runNF } from "../../inference/__tests__/util";

const C = EB.Constructors;
const V = NF.Constructors;
const D = EB.DSL;
const lambda = (name: string, body: EB.Term) => D.lambda(name, body, EB.Any);
const operation = (identity: string, payload: EB.Term) => C.Bubble(EB.nextCount(), D.type("Num"), [], D.type(identity), payload);
const install = (identity: string, handler: EB.Term, body: EB.Term) => C.Reset(body, { identity: D.type(identity), handler });
const resume = lambda("p", lambda("k", D.app(D.bound(0), D.bound(1))));
const abort = (value: number) => lambda("p", lambda("k", D.num(value)));
const evaluate = (ctx: EB.Context, term: EB.Term) => runNF(ctx, () => NF.evaluate(term));
const quote = (ctx: EB.Context, value: NF.Value) => runNF(ctx, () => NF.quote(ctx.env.length, value));
const resolve = (ctx: EB.Context, term: EB.Term): EB.Context => ({ ...ctx, env: [{ ...ctx.env[0], nf: evaluate(mkCtx(), term) }, ...ctx.env.slice(1)] });

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("retained handlers", () => {
	it("quotes a blocked call under its original identity and handler references", () => {
		const ctx = EB.bind({ ...mkCtx(), imports: { E: [D.type("EffectIdentity"), NF.Any], h: [resume, NF.Any] } }, { type: "Lambda", variable: "f" }, NF.Any);
		const term = C.Reset(D.app(D.bound(0), D.num(9)), { identity: D.free("E"), handler: D.free("h") });
		const value = evaluate(ctx, term);
		expect(value).toMatchObject({ type: "Neutral", kind: "Blocked", value: { type: "Reset" } });
		const quoted = quote(ctx, value);
		expect(quoted).toMatchObject({
			type: "Reset",
			handling: { identity: { type: "Var", variable: { type: "Free", name: "E" } }, handler: { type: "Var", variable: { type: "Free", name: "h" } } },
			term: { type: "App", func: { type: "Var", variable: { type: "Bound", index: 0 } } },
		});
		const resolved = resolve(ctx, lambda("n", operation("EffectIdentity", D.bound(0))));
		expect(runNF(resolved, () => NF.view(evaluate(resolved, quoted)))).toMatchObject({
			kind: "Sealed",
			value: { type: "Lit", value: { type: "Num", value: 9 } },
		});
	});

	it("retains an unresolved operation under an enclosing handler", () => {
		const ctx = mkCtx();
		const quoted = quote(ctx, evaluate(ctx, install("E", resume, operation("F", D.num(9)))));
		expect(quoted).toMatchObject({ type: "Reset", handling: { identity: { type: "Lit", value: { value: "E" } } }, term: { type: "Bubble" } });
		expect(evaluate(ctx, install("F", resume, quoted))).toMatchObject({ type: "Lit", value: { type: "Num", value: 9 } });
	});

	it("retains the reset around an existential with a concrete reduced body", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, NF.Any);
		const body = D.app(lambda("x", D.num(7)), D.app(D.bound(0), D.num(9)));
		const quoted = quote(ctx, evaluate(ctx, install("E", abort(41), body)));
		expect(quoted).toMatchObject({ type: "Reset", term: { type: "Block", statements: [{ type: "Let" }], return: { type: "Lit", value: { value: 7 } } } });
		const resolved = resolve(ctx, lambda("n", operation("E", D.bound(0))));
		expect(evaluate(resolved, quoted)).toMatchObject({ type: "Lit", value: { type: "Num", value: 41 } });
	});

	it("evaluates the identity, handler and body once in source order", () => {
		const identity = vi.fn(() => V.Atom("E"));
		const handler = vi.fn(() => evaluate(mkCtx(), resume));
		const body = vi.fn(() => V.Lit({ type: "Num", value: 9 }));
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, NF.Any);
		const observed = {
			...ctx,
			ffi: { ...ctx.ffi, identity: { arity: 0, compute: identity }, handler: { arity: 0, compute: handler }, body: { arity: 0, compute: body } },
		};
		const term = C.Reset(D.app(D.bound(0), D.foreign("body")), { identity: D.foreign("identity"), handler: D.foreign("handler") });
		const quoted = quote(observed, evaluate(observed, term));
		expect(quoted).toMatchObject({ type: "Reset" });
		expect(identity).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(body).toHaveBeenCalledTimes(1);
		expect(identity.mock.invocationCallOrder[0]).toBeLessThan(handler.mock.invocationCallOrder[0]);
		expect(handler.mock.invocationCallOrder[0]).toBeLessThan(body.mock.invocationCallOrder[0]);
	});

	it("returns a concrete body through the delimiter", () => {
		const ctx = mkCtx();
		expect(quote(ctx, evaluate(ctx, install("E", abort(41), D.num(7))))).toMatchObject({ type: "Lit", value: { type: "Num", value: 7 } });
	});

	it("quotes a resumed blocked call after its shallow delimiter has been consumed", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, NF.Any);
		const handler = lambda("p", lambda("k", D.app(D.bound(0), D.add(D.bound(1), D.num(1)))));
		const term = install("E", handler, D.app(lambda("x", D.app(D.bound(1), D.bound(0))), operation("E", D.num(1))));
		const quoted = quote(ctx, evaluate(ctx, term));
		expect(quoted).toMatchObject({ type: "App", func: { type: "Var", variable: { type: "Bound", index: 0 } }, arg: { type: "Lit", value: { value: 2 } } });
		const resolved = resolve(ctx, lambda("n", operation("E", D.bound(0))));
		expect(evaluate(resolved, quoted)).toMatchObject({
			type: "Neutral",
			kind: "Blocked",
			value: { type: "Bubble", payload: { type: "Lit", value: { value: 2 } } },
		});
		expect(evaluate(resolved, install("E", abort(73), quoted))).toMatchObject({ type: "Lit", value: { type: "Num", value: 73 } });
	});

	it("retains an intervening delimiter restored by a resumption", () => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "f" }, NF.Any);
		const term = install("E", resume, install("F", abort(41), D.add(operation("E", D.num(1)), D.app(D.bound(0), D.num(2)))));
		const quoted = quote(ctx, evaluate(ctx, term));
		assert(quoted.type === "Reset");
		expect(quoted.handling?.identity).toMatchObject({ type: "Lit", value: { value: "F" } });
		const resolved = resolve(ctx, lambda("n", operation("F", D.bound(0))));
		expect(evaluate(resolved, quoted)).toMatchObject({ type: "Lit", value: { type: "Num", value: 41 } });
	});

	it.each(["blocked", "existential"] as const)("preserves function-before-argument handling after a %s function", kind => {
		const ctx = mkCtx();
		const blocked = operation("F", D.num(1));
		const func = kind === "blocked" ? blocked : D.app(lambda("z", lambda("x", D.bound(0))), blocked);
		const term = install("E", abort(29), D.app(func, operation("E", D.num(2))));
		const quoted = quote(ctx, evaluate(ctx, term));
		expect(quoted).toMatchObject({ type: "Reset" });
		const aborting = abort(11);
		expect(evaluate(ctx, install("F", aborting, term))).toMatchObject({ type: "Lit", value: { type: "Num", value: 11 } });
		expect(evaluate(ctx, install("F", aborting, quoted))).toMatchObject({ type: "Lit", value: { type: "Num", value: 11 } });
		const resuming = lambda("p", lambda("k", D.app(D.bound(0), lambda("x", D.bound(0)))));
		expect(evaluate(ctx, install("F", resuming, term))).toMatchObject({ type: "Lit", value: { type: "Num", value: 29 } });
		expect(evaluate(ctx, install("F", resuming, quoted))).toMatchObject({ type: "Lit", value: { type: "Num", value: 29 } });
	});
});
