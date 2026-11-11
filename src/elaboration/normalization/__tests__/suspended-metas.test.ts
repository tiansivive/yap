import { beforeEach, describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";
import * as R from "@yap/shared/rows";
import { mkCtx, runEB } from "../../inference/__tests__/util";

const meta = (val: number, lvl = 0) => NF.Constructors.Var(EB.Meta(val, lvl));
const bound = (index: number) => EB.Constructors.Var(EB.Bound(index));
const seed = (...ids: number[]): Metas.Registry => Object.fromEntries(ids.map(val => [val, { meta: EB.Meta(val, 0), annotation: NF.Type }]));
const captured = (nf: NF.Value, annotation = NF.Type): EB.Context["env"][number] => ({
	nf,
	name: { type: "Let", variable: "saved" },
	type: [{ type: "Let", variable: "saved" }, "source", annotation],
});
const collect = (value: NF.Value, registry: Metas.Registry): number[] =>
	run(mkCtx(), registry, function* () {
		const collectors = yield* Metas.collectors();
		return collectors
			.nf(value)
			.map(meta => meta.val)
			.sort((a, b) => a - b);
	});
const run = <A>(ctx: EB.Context, registry: Metas.Registry, program: () => M.Elaboration<A>): A => {
	const result = runEB(ctx, program, registry);
	if (Eff.failed(result.answer)) {
		throw new Error("The scoped traversal completes successfully");
	}
	return result.answer;
};

beforeEach(() => {
	NF.resetId();
	EB.resetId();
	EB.resetSupply("meta");
	EB.resetSupply("var");
});

describe("Suspended meta scope", () => {
	it("collects captured values and types at the source binder depth", () => {
		const ctx = { ...mkCtx(), env: [captured(meta(1), meta(2)), captured(meta(3))] };
		const term = EB.Constructors.Lambda("local", "Explicit", EB.Constructors.App("Explicit", bound(0), bound(1)), EB.Type);
		const value = NF.Constructors.Deferred({ ctx, term });
		expect(collect(value, seed(1, 2, 3))).toEqual([1, 2]);
	});

	it("collects request signatures and captured continuation values", () => {
		const ctx = { ...mkCtx(), env: [captured(meta(4), meta(5)), captured(meta(6))] };
		const value = NF.Constructors.Computation(
			NF.Constructors.Suspend(meta(1), meta(2), NF.Type, meta(3)),
			[
				{ type: "Sequence", ctx, following: { ctx, term: bound(0) } },
				{ type: "Reset", ctx, identity: NF.Constructors.Atom("$anonymous"), handler: meta(7), signature: meta(8) },
			],
			ctx,
		);
		expect(collect(value, seed(1, 2, 3, 4, 5, 6, 7, 8))).toEqual([1, 2, 3, 4, 5, 7, 8]);
	});

	it("terminates when a captured source references its own semantic value", () => {
		const ctx = { ...mkCtx(), env: [captured(NF.Type)] };
		const value = NF.Constructors.Deferred({ ctx, term: EB.Constructors.App("Explicit", bound(0), EB.Constructors.Var(EB.Meta(1, 0))) });
		ctx.env[0].nf = value;
		expect(collect(value, seed(1))).toEqual([1]);
	});

	it("retains dependencies in a cached observation", () => {
		const source = { ctx: mkCtx(), term: EB.Type, observed: meta(1) };
		expect(collect(NF.Constructors.Deferred(source), seed(1))).toEqual([1]);
		expect(
			NF.Computation.mapSourceValues(
				source,
				value => value,
				term => term,
			),
		).toBe(source);
	});

	it("collects the annotation and fields of a captured Nu scope", () => {
		const field = EB.Constructors.Var(EB.Meta(1, 0));
		const frame: EB.Frame = {
			ctx: mkCtx(),
			labels: ["field"],
			terms: R.Constructors.Row([{ label: "field", value: field }]),
			source: {
				type: "Nu",
				variable: "$nu",
				mode: "strict",
				labels: ["field"],
				scoped: R.Constructors.Empty(),
				annotation: EB.Constructors.Var(EB.Meta(2, 0)),
			},
		};
		const source = { ctx: { ...mkCtx(), local: [frame] }, term: EB.Constructors.Var(EB.Constructors.Vars.NuLabel("field", 0, NF.Type)), observed: NF.Any };
		expect(collect(NF.Constructors.Deferred(source), seed(1, 2))).toEqual([1, 2]);
		expect(
			NF.Computation.mapSourceValues(
				source,
				value => value,
				term => term,
			),
		).toBe(source);
	});

	it("keeps a source Nu binder separate from captured label frames", () => {
		const frame: EB.Frame = { ctx: mkCtx(), labels: ["field"], terms: R.Constructors.Row([{ label: "field", value: EB.Constructors.Var(EB.Meta(2, 0)) }]) };
		const term = EB.Constructors.Nu(
			{ mode: "strict", labels: ["field"], scoped: R.Constructors.Row([{ label: "field", value: EB.Constructors.Var(EB.Meta(1, 0)) }]), annotation: EB.Type },
			EB.Constructors.Var(EB.Constructors.Vars.NuLabel("field", 0, NF.Type)),
		);
		expect(collect(NF.Constructors.Deferred({ ctx: { ...mkCtx(), local: [frame] }, term }), seed(1, 2))).toEqual([1]);
	});

	it("invalidates an observation when a captured type changes", () => {
		const annotation = meta(1);
		const source = { ctx: { ...mkCtx(), env: [captured(NF.Type, annotation)] }, term: bound(0), observed: NF.Type };
		const rewritten = NF.Computation.mapSourceValues(
			source,
			value => (value === annotation ? NF.Any : value),
			term => term,
		);
		expect(rewritten.observed).toBeUndefined();
		expect(rewritten.ctx.env[0].type[2]).toBe(NF.Any);
	});

	it("instantiates pending sources structurally under their captured scope", () => {
		const ctx = { ...mkCtx(), env: [captured(meta(1, 0))] };
		const local = EB.Constructors.Var(EB.Meta(2, 1));
		const term = EB.Constructors.Suspend(EB.Constructors.Var({ type: "Foreign", name: "Effect" }), bound(0), local);
		const value = NF.Constructors.Deferred({ ctx, term });
		const result = run(ctx, seed(1, 2), () => NF.instantiate(value));
		expect(result).toMatchObject({
			type: "Deferred",
			source: { term: { type: "Suspend", annotation: { type: "Lit", value: { type: "Atom", value: "Any" } } } },
		});
		if (result.type === "Deferred") {
			expect(result.source.ctx.env[0].nf).toBe(ctx.env[0].nf);
		}
	});

	it("keeps metas introduced inside a saved binder at that binder's depth", () => {
		const ctx = { ...mkCtx(), env: [captured(NF.Type)] };
		const body = EB.Constructors.Var(EB.Meta(1, 1));
		const term = EB.Constructors.Lambda("local", "Explicit", body, EB.Type);
		const result = run(ctx, seed(1), () => NF.instantiate(NF.Constructors.Deferred({ ctx, term })));
		expect(result).toMatchObject({ type: "Deferred", source: { term: { type: "Abs", body: { type: "Var", variable: { type: "Meta", val: 1 } } } } });
	});

	it("trims a saved computation environment and clears its observation", () => {
		const ctx = { ...mkCtx(), env: [captured(NF.Type), captured(NF.Any)] };
		const value = NF.Constructors.Computation(NF.Type, [{ type: "Sequence", ctx, following: { ctx, term: bound(0), observed: NF.Any } }], ctx);
		const result = NF.trimClosureEnvs(value);
		expect(result).toMatchObject({ type: "Computation", contexts: [{ type: "Sequence", following: { ctx: { env: [captured(NF.Type)] } } }] });
		if (result.type === "Computation" && result.contexts[0].type === "Sequence") {
			expect(result.contexts[0].following.observed).toBeUndefined();
		}
	});
});
