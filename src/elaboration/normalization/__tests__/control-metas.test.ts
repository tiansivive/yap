import assert from "node:assert";
import { beforeEach, describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as U from "@yap/elaboration/unification";
import * as Sub from "@yap/elaboration/unification/substitution";
import * as Eff from "@yap/utils/effects";
import { mkCtx, runEB, runNF } from "../../inference/__tests__/util";

const C = EB.Constructors;
const V = NF.Constructors;
const D = EB.DSL;
const resultId = 100;
const afterSuspension = (meta: EB.Meta) => D.app(D.lambda("x", C.Var(meta), D.type("Type")), C.Bubble(resultId, D.type("Type"), [], D.type("E"), D.num(0)));
const retained = (value: NF.Value, annotation = NF.Irrelevant, assumption = NF.Type) => {
	const key = { type: "Bound", lvl: 0 } as const;
	const ctx = EB.extend(mkCtx(), { type: "Let", variable: "$r0" }, V.Rigid(0));
	const owner = V.Exists("$r0", annotation, { ctx, value }, new Map([[key, assumption]]));
	assert(owner.type === "Existential");
	return owner;
};

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("control meta traversal", () => {
	it("collects metas from every direct Bubble operand in Core and NF", () => {
		const result = runEB(mkCtx(), function* () {
			const metas = yield* M.traverse(["annotation", "candidate", "identity", "payload"], () => EB.freshMeta(0, NF.Type));
			const [annotation, candidate, identity, payload] = metas;
			const core = C.Bubble(resultId, C.Var(annotation), [V.Flex(candidate)], C.Var(identity), C.Var(payload));
			const value = V.Bubble(resultId, V.Flex(annotation), [V.Flex(candidate)], V.Flex(identity), V.Flex(payload));
			const collect = yield* Metas.collectors();
			return { metas, core: collect.eb(core), value: collect.nf(value) };
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer.core).toEqual(result.answer.metas);
		expect(result.answer.value).toEqual(result.answer.metas);
	});

	it("substitutes solved Bubble syntax and defaults its semantic candidates", () => {
		const result = runEB(mkCtx(), function* () {
			const solved = yield* EB.freshMeta(0, NF.Type);
			const candidate = yield* EB.freshMeta(0, NF.Type);
			yield* Metas.registry.modify(registry => Metas.solve(registry, solved.val, V.Atom("Num")));
			return yield* EB.Icit.instantiate(C.Bubble(resultId, C.Var(solved), [V.Flex(candidate)], C.Var(solved), C.Var(solved)), {});
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer).toMatchObject({
			type: "Bubble",
			meta: resultId,
			ann: { type: "Lit", value: { value: "Num" } },
			identity: { type: "Lit", value: { value: "Num" } },
			payload: { type: "Lit", value: { value: "Num" } },
		});
		assert(result.answer.type === "Bubble");
		const candidate = result.answer.values[0];
		expect(runNF(mkCtx(), () => NF.view(candidate), result.registry)).toMatchObject({ value: { type: "Lit", value: { value: "Any" } } });
	});

	it("transforms Bubble syntax while retaining semantic candidates for their own traversal", () => {
		const meta = EB.Meta(0, 0);
		const candidates = [V.Flex(meta)];
		const term = C.Bubble(resultId, C.Var(meta), candidates, C.Var(meta), C.Var(meta));
		const transformed = EB.traverse(term, () => D.type("String"));
		assert(transformed.type === "Bubble");
		const expected = { type: "Lit", value: { type: "Atom", value: "String" } };
		expect([transformed.ann, transformed.identity, transformed.payload]).toMatchObject([expected, expected, expected]);
		expect(transformed.values).toBe(candidates);
	});

	it("collects metas across retained handlers, assumptions, annotations and bodies", () => {
		const result = runEB(mkCtx(), function* () {
			const metas = yield* M.traverse(["identity", "handler", "annotation", "assumption", "body"], () => EB.freshMeta(0, NF.Type));
			const [identity, handler, annotation, assumption, body] = metas;
			const value = V.Reset(retained(V.Flex(body), V.Flex(annotation), V.Flex(assumption)), { identity: V.Flex(identity), handler: V.Flex(handler) });
			const collect = yield* Metas.collectors();
			return { metas, collected: collect.nf(value) };
		});
		assert(!Eff.failed(result.answer));
		expect(new Set(result.answer.collected.map(meta => meta.val))).toEqual(new Set(result.answer.metas.map(meta => meta.val)));
	});

	it("transforms retained work and preserves its context and assumption keys", () => {
		const meta = EB.Meta(0, 0);
		const pending = retained(V.Flex(meta), V.Flex(meta), V.Bubble(resultId, V.Flex(meta), [V.Flex(meta)], V.Flex(meta), V.Flex(meta)));
		const value = V.Reset(pending, { identity: V.Flex(meta), handler: V.Flex(meta) });
		const transformed = NF.traverse(
			value,
			() => V.Atom("String"),
			term => EB.traverse(term, () => D.type("String")),
		);
		assert(transformed.type === "Reset" && transformed.value.type === "Existential");
		const body = transformed.value;
		expect(body.body.ctx).toBe(pending.body.ctx);
		expect([...body.assumptions.keys()][0]).toBe([...pending.assumptions.keys()][0]);
		const collect = runNF(mkCtx(), Metas.collectors);
		expect(collect.nf(transformed)).toEqual([]);
		expect(runNF(mkCtx(), () => NF.view(body.body.value))).toMatchObject({ value: { value: { value: "String" } } });
	});

	it.each(["Elaboration", "Predicate", "State"] as const)("defaults retained %s metas according to ownership", kind => {
		const result = runEB(mkCtx(), function* () {
			const meta = yield* EB.freshMeta(0, NF.Type, kind);
			const pending = retained(V.Flex(meta), V.Flex(meta), V.Bubble(resultId, V.Flex(meta), [V.Flex(meta)], V.Flex(meta), V.Flex(meta)));
			const value = V.Reset(pending, { identity: V.Flex(meta), handler: V.Flex(meta) });
			return { meta, pending, value: yield* NF.instantiate(value), collect: yield* Metas.collectors() };
		});
		assert(!Eff.failed(result.answer));
		const { meta, pending, value, collect } = result.answer;
		assert(value.type === "Reset" && value.value.type === "Existential");
		expect(value.value.body.ctx).toBe(pending.body.ctx);
		expect([...value.value.assumptions.keys()][0]).toBe([...pending.assumptions.keys()][0]);
		expect(collect.nf(value)).toEqual(kind === "Elaboration" ? [] : [meta]);
	});

	it("collects a meta used only after a suspension", () => {
		const result = runEB(mkCtx(), function* () {
			const meta = yield* EB.freshMeta(0, NF.Type);
			const value = yield* NF.evaluate(afterSuspension(meta));
			const collect = yield* Metas.collectors();
			return { meta, collected: collect.nf(value) };
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer.collected).toEqual([result.answer.meta]);
	});

	it("defaults an unconstrained type meta used only after a suspension", () => {
		const result = runEB(mkCtx(), function* () {
			const meta = yield* EB.freshMeta(0, NF.Type);
			const value = yield* NF.instantiate(yield* NF.evaluate(afterSuspension(meta)));
			return yield* NF.quote(0, value);
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer).toMatchObject({ type: "Block", return: { type: "Lit", value: { value: "Any" } } });
	});

	it("transforms a meta used only after a suspension", () => {
		const result = runEB(mkCtx(), function* () {
			const meta = yield* EB.freshMeta(0, NF.Type);
			const value = yield* NF.evaluate(afterSuspension(meta));
			const transformed = NF.traverse(
				value,
				() => V.Atom("String"),
				term => EB.traverse(term, () => D.type("String")),
			);
			return yield* NF.quote(0, transformed);
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer).toMatchObject({ type: "Block", return: { type: "Lit", value: { value: "String" } } });
	});

	const positions: ReadonlyArray<[string, (meta: NF.Value) => NF.Value]> = [
		["Bubble annotation", meta => V.Bubble(resultId, meta, [], NF.Type, NF.Type)],
		["Bubble candidate", meta => V.Bubble(resultId, NF.Type, [meta], NF.Type, NF.Type)],
		["Bubble identity", meta => V.Bubble(resultId, NF.Type, [], meta, NF.Type)],
		["Bubble payload", meta => V.Bubble(resultId, NF.Type, [], NF.Type, meta)],
		["retained annotation", meta => retained(NF.Type, meta)],
		["retained assumption", meta => retained(NF.Type, NF.Irrelevant, meta)],
		["retained body", meta => retained(meta)],
		["handler identity", meta => V.Reset(NF.Type, { identity: meta, handler: NF.Type })],
		["handler", meta => V.Reset(NF.Type, { identity: NF.Type, handler: meta })],
		["handler body", meta => V.Reset(meta, { identity: NF.Type, handler: NF.Type })],
	];

	it.each(positions)("checks occurrences in the %s", (_, wrap) => {
		expect(() =>
			runEB(mkCtx(), function* () {
				const meta = yield* EB.freshMeta(0, NF.Type);
				return yield* Eff.with([Sub.subst.handlers()], () => U.bind(meta, wrap(V.Flex(meta))));
			}),
		).toThrow("Occurs check failed");
	});

	const syntax: ReadonlyArray<[string, (meta: EB.Meta) => EB.Term]> = [
		["Bubble annotation", meta => C.Bubble(resultId, C.Var(meta), [], D.type("E"), D.num(0))],
		["Bubble candidate", meta => C.Bubble(resultId, D.type("Type"), [V.Flex(meta)], D.type("E"), D.num(0))],
		["Bubble identity", meta => C.Bubble(resultId, D.type("Type"), [], C.Var(meta), D.num(0))],
		["Bubble payload", meta => C.Bubble(resultId, D.type("Type"), [], D.type("E"), C.Var(meta))],
		["Reset identity", meta => C.Reset(D.num(0), { identity: C.Var(meta), handler: D.type("Handler") })],
		["Reset handler", meta => C.Reset(D.num(0), { identity: D.type("E"), handler: C.Var(meta) })],
		["Reset body", meta => C.Reset(C.Var(meta), { identity: D.type("E"), handler: D.type("Handler") })],
	];

	it.each(syntax)("checks occurrences in %s syntax inside a closure", (_, body) => {
		expect(() =>
			runEB(mkCtx(), function* () {
				const meta = yield* EB.freshMeta(0, NF.Type);
				const value = V.Lambda("x", "Explicit", V.Closure(mkCtx(), body(meta)), NF.Type);
				return yield* Eff.with([Sub.subst.handlers()], () => U.bind(meta, value));
			}),
		).toThrow("Occurs check failed");
	});
});
