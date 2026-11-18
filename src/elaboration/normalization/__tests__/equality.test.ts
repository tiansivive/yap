import { beforeEach, describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Lit from "@yap/shared/literals";
import { OP_EQ, OP_NEQ, PrimOps } from "@yap/shared/lib/primitives";
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
	return { ...ctx, ffi: { ...ctx.ffi, Ask: { arity: 0, compute: () => opaque("Ask") }, Tell: { arity: 0, compute: () => opaque("Tell") } } };
};

beforeEach(() => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
});

describe.each([OP_EQ, OP_NEQ])("Primitive %s readiness", name => {
	const compare = (left: EB.Term, right: EB.Term) => D.app(D.app(D.foreign(name), left), right);
	const external = (args: NF.Value[]) => V.External(name, 2, PrimOps[name].compute, args);

	it.each([
		[Lit.Num(7), Lit.Num(7), true],
		[Lit.Num(7), Lit.Num(8), false],
		[Lit.String("ask"), Lit.String("ask"), true],
		[Lit.Bool(true), Lit.Bool(false), false],
		[Lit.unit(), Lit.unit(), true],
		[Lit.Atom("A"), Lit.Atom("B"), false],
	] as const)("computes literal operands %j and %j", (left, right, equal) => {
		const value = runNF(mkCtx(), () => NF.evaluate(compare(C.Lit(left), C.Lit(right))));
		expect(value).toMatchObject({ type: "Lit", value: Lit.Bool(name === OP_EQ ? equal : !equal) });
	});

	it("observes sealed literals in application and retry", () => {
		const literal = V.Lit(Lit.Num(7));
		const sealed = V.Neutral("Sealed", literal);
		const applied = runNF(mkCtx(), () => NF.reduce(external([sealed]), sealed, "Explicit"));
		const resumed = runNF(mkCtx(), () => NF.force(V.Neutral("Blocked", external([sealed, sealed]))));
		expect(applied).toMatchObject({ type: "Lit", value: Lit.Bool(name === OP_EQ) });
		expect(resumed).toMatchObject({ type: "Lit", value: Lit.Bool(name === OP_EQ) });
	});

	it.each(["Ask", "Tell"])("retains a comparison with foreign atom %s through observation and quotation", other => {
		const ctx = context();
		const value = runNF(ctx, () => NF.evaluate(compare(D.foreign("Ask"), D.foreign(other))));
		const viewed = runNF(ctx, () => NF.view(value));
		expect(viewed).toMatchObject({ kind: "Blocked", value: { type: "External", name, args: [NF.Patterns.Sealed, NF.Patterns.Sealed] } });
		expect(runNF(ctx, () => NF.force(value))).toBe(value);
		const quoted = runNF(ctx, () => NF.quote(0, value));
		expect(quoted).toMatchObject({
			type: "App",
			func: { type: "App", func: { type: "Var", variable: { name } }, arg: { type: "Var", variable: { name: "Ask" } } },
			arg: { type: "Var", variable: { name: other } },
		});
		const repeated = runNF(ctx, () => NF.evaluate(quoted));
		expect(runNF(ctx, () => NF.view(repeated))).toMatchObject({ kind: "Blocked", value: { type: "External", name } });
	});

	it("retains a numeric opaque operand through observation and quotation", () => {
		const base = mkCtx();
		const ctx: EB.Context = {
			...base,
			imports: { ...base.imports, value: [D.foreign("value"), V.Atom("Num"), []] },
			ffi: { ...base.ffi, value: { arity: 0, compute: () => opaque("value") } },
		};
		const value = runNF(ctx, () => NF.evaluate(compare(D.foreign("value"), D.num(7))));
		expect(runNF(ctx, () => NF.view(value))).toMatchObject({ kind: "Blocked", value: { type: "External", name } });
		expect(runNF(ctx, () => NF.force(value))).toBe(value);
		const quoted = runNF(ctx, () => NF.quote(0, value));
		expect(quoted).toMatchObject({
			type: "App",
			func: { type: "App", func: { type: "Var", variable: { name } }, arg: { type: "Var", variable: { name: "value" } } },
			arg: { type: "Lit", value: Lit.Num(7) },
		});
	});

	it("retries a retained comparison after its symbolic operand gains a literal solution", () => {
		const meta = EB.Meta(0, 0);
		const registry = Metas.register(Metas.empty, { kind: "Elaboration", meta, annotation: V.Atom("Num") });
		const value = runNF(mkCtx(), () => NF.evaluate(compare(C.Var(meta), D.num(7))), registry);
		expect(runNF(mkCtx(), () => NF.view(value), registry)).toMatchObject({ kind: "Blocked", value: { type: "External", name } });
		const solved = Metas.solve(registry, meta.val, V.Lit(Lit.Num(7)));
		expect(runNF(mkCtx(), () => NF.force(value), solved)).toMatchObject({ type: "Lit", value: Lit.Bool(name === OP_EQ) });
	});
});
