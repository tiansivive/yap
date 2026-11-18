import assert from "node:assert";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";
import { OP_ADD, OP_CONCAT, OP_EQ, OP_GT, OP_NEQ, PrimOps } from "@yap/shared/lib/primitives";
import { mkCtx, runNF } from "../../inference/__tests__/util";

const C = EB.Constructors;
const V = NF.Constructors;
const D = EB.DSL;
const opaque = (name: string): NF.Value =>
	V.Neutral(
		"Sealed",
		V.External(name, 0, () => opaque(name), []),
	);
const context = (): EB.Context => {
	const ctx = mkCtx();
	return { ...ctx, ffi: { ...ctx.ffi, opaque: { arity: 0, compute: () => opaque("opaque") } } };
};

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe.each([
	{ name: OP_EQ, literal: Lit.Num(7), expected: Lit.Bool(true) },
	{ name: OP_NEQ, literal: Lit.Num(7), expected: Lit.Bool(false) },
	{ name: OP_ADD, literal: Lit.Num(7), expected: Lit.Num(14) },
	{ name: OP_GT, literal: Lit.Num(7), expected: Lit.Bool(false) },
	{ name: OP_CONCAT, literal: Lit.String("word"), expected: Lit.String("wordword") },
])("External operands for $name", ({ name, literal, expected }) => {
	const apply = (left: EB.Term, right: EB.Term) => D.app(D.app(D.foreign(name), left), right);

	it("computes supported foreign results", () => {
		const base = mkCtx();
		const ctx: EB.Context = {
			...base,
			ffi: { ...base.ffi, constant: { arity: 0, compute: () => V.Lit(literal) }, read: { arity: 1, compute: value => value } },
		};
		const value = runNF(ctx, () => NF.evaluate(apply(D.foreign("constant"), D.app(D.foreign("read"), C.Lit(literal)))));
		expect(value).toMatchObject({ type: "Lit", value: expected });
	});

	it("blocks an opaque foreign result", () => {
		const ctx = context();
		const value = runNF(ctx, () => NF.evaluate(apply(D.foreign("opaque"), C.Lit(literal))));
		expect(runNF(ctx, () => NF.view(value))).toMatchObject({ kind: "Blocked", value: { type: "External", name } });
	});
});

describe("External operand structure", () => {
	const literal = Lit.Num(7);
	const external = (args: NF.Value[]) => V.External(OP_ADD, 2, PrimOps[OP_ADD].compute, args);

	it("observes concrete operand wrappers in application and retry", () => {
		const wrapped = V.Neutral("Sealed", V.Glued(V.Var({ type: "Free", name: "alias" }), V.Modal(V.Lit(literal), { quantity: Q.Many, liquid: NF.Irrelevant })));
		const applied = runNF(mkCtx(), () => NF.reduce(external([wrapped]), wrapped, "Explicit"));
		const resumed = runNF(mkCtx(), () => NF.force(V.Neutral("Blocked", external([wrapped, wrapped]))));
		expect(applied).toMatchObject({ type: "Lit", value: Lit.Num(14) });
		expect(resumed).toMatchObject({ type: "Lit", value: Lit.Num(14) });
	});

	it.each([
		["foreign reference", () => D.foreign("missing")],
		["opaque result", () => D.foreign("opaque")],
		["foreign application", () => D.app(D.foreign("missing"), D.num(1))],
	] as const)("blocks a %s through observation and quotation", (_shape, source) => {
		const ctx = context();
		const argument = runNF(ctx, () => NF.evaluate(source()));
		const value = runNF(ctx, () => NF.reduce(external([argument]), V.Lit(literal), "Explicit"));
		const viewed = runNF(ctx, () => NF.view(value));
		assert(viewed.value.type === "External");
		expect(viewed.kind).toBe("Blocked");
		expect(viewed.value.name).toBe(OP_ADD);
		expect(viewed.value.args[0]).toBe(argument);
		expect(runNF(ctx, () => NF.force(value))).toBe(value);
		const quoted = runNF(ctx, () => NF.quote(0, value));
		expect(quoted).toMatchObject({
			type: "App",
			func: { type: "App", func: { type: "Var", variable: { name: OP_ADD } } },
			arg: { type: "Lit", value: literal },
		});
		const repeated = runNF(ctx, () => NF.evaluate(quoted));
		expect(runNF(ctx, () => NF.view(repeated))).toMatchObject({ kind: "Blocked", value: { type: "External", name: OP_ADD } });
	});

	it("retries a blocked call after its symbolic operand gains a literal solution", () => {
		const meta = EB.Meta(0, 0);
		const registry = Metas.register(Metas.empty, { kind: "Elaboration", meta, annotation: V.Atom("Num") });
		const value = runNF(mkCtx(), () => NF.evaluate(D.add(C.Var(meta), C.Lit(literal))), registry);
		expect(runNF(mkCtx(), () => NF.view(value), registry)).toMatchObject({ kind: "Blocked", value: { type: "External", name: OP_ADD } });
		const solved = Metas.solve(registry, meta.val, V.Lit(literal));
		expect(runNF(mkCtx(), () => NF.force(value), solved)).toMatchObject({ type: "Lit", value: Lit.Num(14) });
	});
});

it("blocks an opaque stringify result supplied to concatenation", () => {
	const stringify = (value: NF.Value): NF.Value => V.Neutral("Sealed", V.External("stringify", 1, stringify, [value]));
	const base = mkCtx();
	const ctx = { ...base, ffi: { ...base.ffi, stringify: { arity: 1, compute: stringify } } };
	const core = D.app(D.app(D.foreign(OP_CONCAT), D.app(D.foreign("stringify"), D.num(7))), C.Lit(Lit.String("!")));
	const value = runNF(ctx, () => NF.evaluate(core));
	const viewed = runNF(ctx, () => NF.view(value));
	expect(viewed).toMatchObject({
		kind: "Blocked",
		value: { type: "External", name: OP_CONCAT, args: [NF.Patterns.Sealed, { type: "Lit", value: Lit.String("!") }] },
	});
	expect(runNF(ctx, () => NF.force(value))).toBe(value);
	const quoted = runNF(ctx, () => NF.quote(0, value));
	expect(runNF(ctx, () => NF.view(runNF(ctx, () => NF.evaluate(quoted))))).toMatchObject({ kind: "Blocked", value: { type: "External", name: OP_CONCAT } });
});

it("keeps a saturated protected application blocked with its original operand", () => {
	const literal = V.Lit(Lit.Num(7));
	const compute = vi.fn(() => literal);
	const protectedHead = V.External("protected", 1, compute, []);
	const argument = V.Neutral("Sealed", V.App(protectedHead, literal, "Explicit"));
	const external = (args: NF.Value[]) => V.External(OP_ADD, 2, PrimOps[OP_ADD].compute, args);
	const value = runNF(mkCtx(), () => NF.reduce(external([argument]), literal, "Explicit"));
	const viewed = runNF(mkCtx(), () => NF.view(value));
	assert(viewed.value.type === "External");
	expect(viewed.kind).toBe("Blocked");
	expect(viewed.value.args[0]).toBe(argument);
	expect(runNF(mkCtx(), () => NF.force(value))).toBe(value);
	expect(runNF(mkCtx(), () => NF.quote(0, value))).toMatchObject({ func: { arg: { type: "App", func: { type: "Var", variable: { name: "protected" } } } } });
	expect(compute).toHaveBeenCalledTimes(0);
});

it.each([0, 1])("passes a partial external as argument %s and keeps it callable", position => {
	const literal = V.Lit(Lit.Num(7));
	const partial = V.External("partial", 2, first => first, [literal]);
	const receiver = V.External("receiver", 2, (...args) => args[position], []);
	const args = position === 0 ? [partial, literal] : [literal, partial];
	const first = runNF(mkCtx(), () => NF.reduce(receiver, args[0], "Explicit"));
	const returned = runNF(mkCtx(), () => NF.reduce(first, args[1], "Explicit"));
	expect(returned).toBe(partial);
	expect(runNF(mkCtx(), () => NF.reduce(returned, V.Lit(Lit.Num(9)), "Explicit"))).toBe(literal);
});

describe.each([OP_EQ, OP_NEQ])("Literal computation for %s", name => {
	it.each([
		[Lit.Num(7), Lit.Num(7), true],
		[Lit.Num(7), Lit.Num(8), false],
		[Lit.String("ask"), Lit.String("ask"), true],
		[Lit.Bool(true), Lit.Bool(false), false],
		[Lit.unit(), Lit.unit(), true],
		[Lit.Atom("A"), Lit.Atom("B"), false],
	] as const)("compares literal operands %j and %j", (left, right, equal) => {
		const core = D.app(D.app(D.foreign(name), C.Lit(left)), C.Lit(right));
		const value = runNF(mkCtx(), () => NF.evaluate(core));
		expect(value).toMatchObject({ type: "Lit", value: Lit.Bool(name === OP_EQ ? equal : !equal) });
	});
});
