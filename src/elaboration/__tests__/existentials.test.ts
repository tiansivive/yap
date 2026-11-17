import assert from "node:assert";
import { beforeEach, describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as U from "@yap/elaboration/unification";
import * as Sub from "@yap/elaboration/unification/substitution";
import * as Eff from "@yap/utils/effects";
import { mkCtx, parseExpr, runEB, runNF } from "../inference/__tests__/util";
import { elaborateModule } from "./module";

const D = EB.DSL;
const context = () => EB.bind(mkCtx(), { type: "Lambda", variable: "F" }, NF.Any);
const retained = (ctx: EB.Context, body: EB.Term, index = 0) =>
	runNF(ctx, () => NF.evaluate(D.app(D.lambda("r", body, D.type("Type")), D.app(D.bound(index), D.num(5)))));
const unify = (ctx: EB.Context, left: NF.Value, right: NF.Value) =>
	runEB(ctx, function* () {
		const [, subst] = yield* Eff.with([Sub.subst.handlers()], () => U.unify(left, right, ctx.env.length));
		return subst;
	});

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe("checking retained expected types", () => {
	it("checks a lambda against an arrow retained inside nested existentials", () => {
		const ctx = context();
		const arrow = EB.Constructors.Pi("x", "Explicit", D.type("Num"), D.type("Num"));
		const expected = NF.Constructors.Exists("outer", NF.Irrelevant, { ctx, value: retained(ctx, arrow) });
		const result = runEB(ctx, function* () {
			const [term] = yield* EB.check(parseExpr("\\x -> x"), expected);
			const { constraints } = yield* M.writer.peek();
			yield* EB.solve(constraints);
			return term;
		});
		assert(!Eff.failed(result.answer));
		expect(result.answer).toMatchObject({
			type: "Abs",
			binding: { type: "Lambda", annotation: { type: "Lit", value: { type: "Atom", value: "Num" } } },
			body: { type: "Var", variable: { type: "Bound", index: 0 } },
		});
		expect(result.state.discharged.size).toBe(result.collected.constraints.length);
	});

	it("elaborates a constant arrow family applied to a blocked call", () => {
		const result = elaborateModule(String.raw`
			let Arrow: Type -> Type = \T -> (Num -> Num);
			let id: (F: Num -> Type) -> Arrow (F 5) = \F x -> x;
		`);
		expect(result.declarations.map(declaration => declaration.error)).toEqual([undefined, undefined]);
		expect(result.declarations.every(declaration => declaration.elaborated)).toBe(true);
	});

	it("elaborates an arrow whose argument and result use the retained type", () => {
		const result = elaborateModule(String.raw`
			let Endo: Type -> Type = \T -> (T -> T);
			let id: (F: Num -> Type) -> Endo (F 5) = \F x -> x;
		`);
		expect(result.declarations.map(declaration => declaration.error)).toEqual([undefined, undefined]);
		expect(result.declarations.every(declaration => declaration.elaborated)).toBe(true);
	});

	// TODO(retained-scope): preserve the retained result in generated binder annotations.
	it.fails("specializes the checked lambda annotation to the retained result type", () => {
		const result = elaborateModule(String.raw`
			let Endo: Type -> Type = \T -> (T -> T);
			let id: (F: Num -> Type) -> Endo (F 5) = \F x -> x;
			let numId = id (\n -> Num);
		`);
		const elaborated = result.declarations[2].elaborated;
		assert(elaborated);
		const { tm, ctx, registry } = elaborated;
		const annotation = runNF(
			ctx,
			function* () {
				const { value } = yield* NF.view(yield* NF.normalize(tm));
				assert(value.type === "Abs" && value.binder.type === "Lambda");
				return yield* NF.view(value.binder.annotation);
			},
			registry,
		);
		expect(annotation).toMatchObject({ kind: "Sealed", value: { type: "Lit", value: { type: "Atom", value: "Num" } } });
	});
});

describe("conversion of retained values", () => {
	it.each([
		["left", true, false],
		["right", false, true],
		["both", true, true],
	] as const)("compares the body with an existential on %s", (_, left, right) => {
		const ctx = context();
		const num = runNF(ctx, () => NF.evaluate(D.type("Num")));
		const value = retained(ctx, D.type("Num"));
		expect(Eff.failed(unify(ctx, left ? value : num, right ? value : num).answer)).toBe(false);
	});

	it("compares a retained result with itself", () => {
		const ctx = context();
		const value = retained(ctx, D.bound(0));
		expect(Eff.failed(unify(ctx, value, value).answer)).toBe(false);
	});

	it("rejects different bodies", () => {
		const ctx = context();
		expect(Eff.failed(unify(ctx, retained(ctx, D.type("Num")), retained(ctx, D.type("String"))).answer)).toBe(true);
	});

	it("solves a meta against the retained body", () => {
		const ctx = context();
		const value = retained(ctx, D.type("Num"));
		const result = runEB(ctx, function* () {
			const meta = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const [, subst] = yield* Eff.with([Sub.subst.handlers()], () => U.unify(NF.Constructors.Flex(meta), value, ctx.env.length));
			return subst[meta.val];
		});
		expect(result.answer).toMatchObject({ type: "Lit", value: { type: "Atom", value: "Num" } });
	});

	it.each(["left", "right"] as const)("preserves the sealed operand when solving an existential body on the %s", side => {
		const ctx = context();
		const sealed = runNF(ctx, () => NF.whnf(D.free("Num")));
		const result = runEB(ctx, function* () {
			const meta = yield* EB.freshMeta(ctx.env.length, NF.Type);
			const value = NF.Constructors.Exists("r", NF.Irrelevant, { ctx, value: NF.Constructors.Flex(meta) });
			const [left, right] = side === "left" ? [value, sealed] : [sealed, value];
			const [, subst] = yield* Eff.with([Sub.subst.handlers()], () => U.unify(left, right, ctx.env.length));
			return subst[meta.val];
		});
		expect(sealed).toMatchObject({ type: "Neutral", kind: "Sealed" });
		expect(result.answer).toBe(sealed);
	});

	// TODO(retained-scope): transport corresponding result binders when their owners move.
	it.fails("compares a retained result after moving its owner under a binder", () => {
		const ctx = context();
		const inner = EB.bind(ctx, { type: "Lambda", variable: "x" }, NF.Any);
		const left = retained(ctx, D.bound(0));
		const right = retained(inner, D.bound(0), 1);
		expect(Eff.failed(unify(inner, left, right).answer)).toBe(false);
	});

	// TODO(retained-assumptions): compare the computations owned by coincident result levels.
	it.fails("distinguishes retained results of different calls at the same level", () => {
		const ctx = EB.bind(context(), { type: "Lambda", variable: "G" }, NF.Any);
		const left = retained(ctx, D.bound(0), 0);
		const right = retained(ctx, D.bound(0), 1);
		expect(Eff.failed(unify(ctx, left, right).answer)).toBe(true);
	});
});
