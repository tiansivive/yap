import assert from "node:assert";
import { beforeEach, describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as U from "@yap/elaboration/unification";
import * as Sub from "@yap/elaboration/unification/substitution";
import * as R from "@yap/shared/rows";
import * as Lit from "@yap/shared/literals";
import { Liquid } from "@yap/verification/modalities";
import * as Eff from "@yap/utils/effects";
import { mkCtx, runEB } from "../inference/__tests__/util";

const kinds = ["Predicate", "State"] as const;
const unify = function* (left: NF.Value, right: NF.Value): M.Elaboration<Sub.Subst> {
	const ctx = yield* M.reader.ask();
	const [, subst] = yield* Eff.with([Sub.subst.handlers()], () => U.unify(left, right, ctx.env.length));
	return subst;
};

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("meta ownership", () => {
	it("stores kinds in the shared registry through solving and replay", () => {
		const result = runEB(mkCtx(), function* () {
			const ordinary = yield* EB.freshMeta(0, NF.Type);
			const predicate = yield* EB.freshMeta(0, NF.Type, "Predicate");
			const state = yield* EB.freshMeta(0, NF.Row, "State");
			return [ordinary, predicate, state];
		});
		assert(!Eff.failed(result.answer));
		const [ordinary, predicate, state] = result.answer;
		expect(Object.values(result.registry).map(entry => entry.kind)).toEqual(["Elaboration", "Predicate", "State"]);
		const solved = Metas.withSolutions(result.registry, Sub.from({ [ordinary.val]: NF.Type, [predicate.val]: NF.Any, [state.val]: NF.Row }));
		expect(Metas.unsolved(solved)).toEqual(result.registry);
		expect(Metas.merge(result.registry, [solved, solved])).toEqual(solved);
	});

	it.each(kinds)("compares a %s meta with itself", kind => {
		const result = runEB(mkCtx(), function* () {
			const meta = yield* EB.freshMeta(0, NF.Type, kind);
			return yield* unify(NF.Constructors.Flex(meta), NF.Constructors.Flex(meta));
		});
		assert(!Eff.failed(result.answer));
		expect(Sub.isEmpty(result.answer)).toBe(true);
	});

	it.each(kinds)("binds the ordinary meta on either side of a %s meta", kind => {
		const result = runEB(mkCtx(), function* () {
			const ordinary = yield* EB.freshMeta(0, NF.Type);
			const owned = yield* EB.freshMeta(0, NF.Type, kind);
			const a = NF.Constructors.Flex(ordinary);
			const b = NF.Constructors.Flex(owned);
			return { ordinary, owned, left: yield* unify(a, b), right: yield* unify(b, a) };
		});
		assert(!Eff.failed(result.answer));
		const { ordinary, owned, left, right } = result.answer;
		expect(Object.keys(left)).toEqual([String(ordinary.val)]);
		expect(Object.keys(right)).toEqual([String(ordinary.val)]);
		expect(left[ordinary.val]).toMatchObject({ type: "Var", variable: owned });
		expect(right[ordinary.val]).toMatchObject({ type: "Var", variable: owned });
		expect(Metas.solution(result.registry, owned.val)).toBeUndefined();
	});

	it.each(kinds)("rejects ordinary assignment to a %s meta", kind => {
		const result = runEB(mkCtx(), function* () {
			const meta = yield* EB.freshMeta(0, NF.Type, kind);
			return yield* unify(NF.Constructors.Flex(meta), NF.Any);
		});
		assert(Eff.failed(result.answer));
		expect(result.answer[Eff.ABORT].type).toBe("TypeMismatch");
		expect(Object.values(result.registry).every(entry => entry.solution === undefined)).toBe(true);
	});

	it.each(kinds)("requires equality evidence for distinct %s metas", kind => {
		const result = runEB(mkCtx(), function* () {
			const left = yield* EB.freshMeta(0, NF.Type, kind);
			const right = yield* EB.freshMeta(0, NF.Type, kind);
			return yield* unify(NF.Constructors.Flex(left), NF.Constructors.Flex(right));
		});
		expect(Eff.failed(result.answer)).toBe(true);
	});

	it.each(kinds)("reads the shared solution of a %s meta during conversion", kind => {
		const result = runEB(mkCtx(), function* () {
			const meta = yield* EB.freshMeta(0, NF.Type, kind);
			yield* Metas.registry.modify(registry => Metas.solve(registry, meta.val, NF.Any));
			return yield* unify(NF.Constructors.Flex(meta), NF.Any);
		});
		assert(!Eff.failed(result.answer));
		expect(Sub.isEmpty(result.answer)).toBe(true);
	});

	it("preserves predicate holes in an ordinary meta's refined solution", () => {
		const result = runEB(mkCtx(), function* () {
			const ordinary = yield* EB.freshMeta(0, NF.Type);
			const predicate = yield* EB.freshMeta(0, NF.Any, "Predicate");
			const refined = NF.Constructors.Modal(NF.Any, { quantity: "Many", liquid: NF.Constructors.Flex(predicate) });
			return { ordinary, predicate, refined, subst: yield* unify(NF.Constructors.Flex(ordinary), refined) };
		});
		assert(!Eff.failed(result.answer));
		const { ordinary, predicate, refined, subst } = result.answer;
		expect(subst[ordinary.val]).toBe(refined);
		expect(Metas.solution(result.registry, predicate.val)).toBeUndefined();
	});

	it("solves a Π domain meta under a call-state-dependent refinement", () => {
		const result = runEB(mkCtx(), function* () {
			const ctx = yield* M.reader.ask();
			const ordinary = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const scoped = EB.bind(ctx, { type: "Psi", variable: "s" }, NF.State);
			const num = NF.Constructors.Lit(Lit.Atom("Num"));
			const unary = yield* Liquid.Predicate.Kind(num);
			const kind = NF.Constructors.Pi("s", "Explicit", NF.State, yield* NF.closeVal(unary));
			const predicate = yield* EB.freshMeta(scoped.env.length, kind, "Predicate");
			const liquid = NF.Constructors.App(NF.Constructors.Flex(predicate), NF.Constructors.Rigid(ctx.env.length), "Explicit");
			const refined = NF.Constructors.Modal(num, { quantity: "Many", liquid });
			const codomain = NF.Constructors.Closure(scoped, EB.Constructors.Lit(Lit.Atom("Bool")));
			const pi = (domain: NF.Value) => NF.Constructors.Pi("x", "Explicit", domain, codomain);
			const unknown = pi(NF.Constructors.Flex(ordinary));
			const solved = yield* EB.freshMeta(scoped.env.length, NF.Type);
			yield* Metas.registry.modify(registry => Metas.solve(registry, solved.val, refined));
			return {
				ordinary,
				num,
				left: yield* M.reader.local(() => scoped, unify(unknown, pi(refined))),
				right: yield* M.reader.local(() => scoped, unify(pi(NF.Constructors.Flex(solved)), unknown)),
			};
		});
		assert(!Eff.failed(result.answer));
		const { ordinary, num, left, right } = result.answer;
		expect(left[ordinary.val]).toBe(num);
		expect(right[ordinary.val]).toBe(num);
	});

	it.each(kinds)("preserves ownership for %s row tails in either orientation", kind => {
		const result = runEB(mkCtx(), function* () {
			const ordinary = yield* EB.freshMeta(0, NF.Row);
			const owned = yield* EB.freshMeta(0, NF.Row, kind);
			const a = NF.Constructors.Row(R.Constructors.Variable(ordinary));
			const b = NF.Constructors.Row(R.Constructors.Variable(owned));
			return { ordinary, left: yield* unify(a, b), right: yield* unify(b, a) };
		});
		assert(!Eff.failed(result.answer));
		expect(Object.keys(result.answer.left)).toEqual([String(result.answer.ordinary.val)]);
		expect(Object.keys(result.answer.right)).toEqual([String(result.answer.ordinary.val)]);
	});

	it.each(kinds)("preserves a %s row tail when a missing field requires rewriting", kind => {
		const result = runEB(mkCtx(), function* () {
			const owned = yield* EB.freshMeta(0, NF.Row, kind);
			const closed = NF.Constructors.Row(R.Constructors.Extension("field", NF.Any, R.Constructors.Extension("other", NF.Any, R.Constructors.Empty())));
			const open = NF.Constructors.Row(R.Constructors.Extension("other", NF.Any, R.Constructors.Variable(owned)));
			return yield* unify(closed, open);
		});
		expect(Eff.failed(result.answer)).toBe(true);
		expect(Object.values(result.registry).every(entry => entry.solution === undefined)).toBe(true);
	});

	it.each(kinds)("generalizes ordinary metas while preserving %s holes", kind => {
		const result = runEB(mkCtx(), function* () {
			const ordinary = yield* EB.freshMeta(0, NF.Type);
			const owned = yield* EB.freshMeta(0, NF.Type, kind);
			const [type, introduced] = yield* NF.generalize(NF.Constructors.Flex(ordinary), EB.Constructors.Var(owned), {});
			return { ordinary, owned, type, introduced };
		});
		assert(!Eff.failed(result.answer));
		const { ordinary, owned, type, introduced } = result.answer;
		expect(introduced).toBe(true);
		expect(type).toMatchObject({ type: "Abs", binder: { type: "Pi", icit: "Implicit" } });
		expect(Metas.solution(result.registry, ordinary.val)).toMatchObject({ type: "Var", variable: { type: "Bound", lvl: 0 } });
		expect(Metas.solution(result.registry, owned.val)).toBeUndefined();
	});

	it.each(kinds)("abstracts ordinary metas while preserving %s holes", kind => {
		const result = runEB(mkCtx(), function* () {
			const ordinary = yield* EB.freshMeta(0, NF.Type);
			const owned = yield* EB.freshMeta(0, NF.Type, kind);
			const abstracted = yield* NF.abstract(NF.Constructors.Flex(ordinary), NF.Constructors.Flex(owned), {});
			return { ordinary, owned, abstracted };
		});
		assert(!Eff.failed(result.answer));
		const { ordinary, owned, abstracted } = result.answer;
		expect(abstracted.term).toMatchObject({ type: "Abs", binding: { type: "Lambda", icit: "Implicit" }, body: { type: "Var", variable: owned } });
		expect(Metas.solution(result.registry, ordinary.val)).toMatchObject({ type: "Var", variable: { type: "Bound", lvl: 0 } });
		expect(Metas.solution(result.registry, owned.val)).toBeUndefined();
	});

	it.each(kinds)("preserves solved %s containers while generalizing an ordinary dependency", kind => {
		const ctx = EB.bind(mkCtx(), { type: "Lambda", variable: "outer" }, NF.Type);
		const result = runEB(ctx, function* () {
			const owned = yield* EB.freshMeta(0, NF.Type, kind);
			const ordinary = yield* EB.freshMeta(1, NF.Type);
			const snapshot = NF.Constructors.Flex(ordinary);
			yield* Metas.registry.modify(registry => Metas.solve(registry, owned.val, snapshot));
			yield* NF.generalize(snapshot, EB.Constructors.Var(owned), {});
			return { owned, snapshot };
		});
		assert(!Eff.failed(result.answer));
		expect(Metas.solution(result.registry, result.answer.owned.val)).toBe(result.answer.snapshot);
		expect(Object.keys(result.registry)).toHaveLength(2);
	});

	it.each(kinds)("preserves %s holes through core and semantic defaulting", kind => {
		const result = runEB(mkCtx(), function* () {
			const ordinary = yield* EB.freshMeta(0, NF.Type);
			const owned = yield* EB.freshMeta(0, NF.Type, kind);
			return {
				owned,
				ordinary: (yield* NF.view(yield* NF.instantiate(NF.Constructors.Flex(ordinary)))).value,
				core: yield* EB.Icit.instantiate(EB.Constructors.Var(owned), {}),
				value: (yield* NF.view(yield* NF.instantiate(NF.Constructors.Flex(owned)))).value,
			};
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer.ordinary).toMatchObject({ type: "Lit", value: { type: "Atom", value: "Any" } });
		expect(result.answer.core).toMatchObject({ type: "Var", variable: result.answer.owned });
		expect(result.answer.value).toMatchObject({ type: "Var", variable: result.answer.owned });
	});
});
