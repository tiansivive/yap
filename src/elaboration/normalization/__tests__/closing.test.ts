import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMatching } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Eff from "@yap/utils/effects";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
import { close, value as readValue } from "../closing";
import { drive } from "../evaluation.v2";
import { Mode, defaultMode, type Scope, type Handling } from "../effects";
import { handlers } from "../machine/handlers";

const empty: EB.Context = { env: [], implicits: [], labels: {}, sigma: {}, record: {}, local: [], imports: {}, ffi: {}, trace: [] };
const variable = (index: number) => EB.Constructors.Var({ type: "Bound", index });
const number = (value: number) => NF.Constructors.Lit(Lit.Num(value));
const captured = (value: NF.Value): EB.Context => ({
	...empty,
	env: [{ name: { type: "Let", variable: "captured" }, type: [{ type: "Let", variable: "captured" }, "source", NF.Type], nf: value }],
});
const run = (term: EB.Term, source: EB.Context, lvl = 0, target = empty) =>
	Eff.run(
		() => drive(close(lvl, { ctx: source, term }), () => "Closure readback exhausted its fuel"),
		[M.reader.handlers(target), Metas.registry.handlers(), Mode.handlers(defaultMode), handlers<Scope, EB.Term, Handling>(10000)],
	)[0];
const observe = (value: NF.Value) => {
	expect(isMatching(NF.Patterns.Deferred, value)).toBe(true);

	if (!isMatching(NF.Patterns.Deferred, value)) {
		throw new Error("Expected a scoped annotation");
	}
	return Eff.run(() => NF.normalize(value.source.term), [M.reader.handlers(value.source.ctx), Metas.registry.handlers()])[0];
};

beforeEach(() => {
	EB.resetId();
	NF.resetId();
});

describe("Source closure readback", () => {
	it("substitutes captured values under lambdas while retaining pending calls and operations", () => {
		const compute = vi.fn(() => number(9));
		const source = { ...captured(number(7)), ffi: { tick: { arity: 0, compute } } };
		const term = EB.Constructors.Lambda(
			"x",
			"Explicit",
			EB.Constructors.Block(
				[EB.Constructors.Stmt.Expr(EB.Constructors.Var({ type: "Foreign", name: "tick" }))],
				EB.Constructors.Suspend(EB.Anonymous, EB.Constructors.App("Explicit", variable(0), variable(1)), EB.Type),
			),
			EB.Type,
		);
		const result = run(term, source);
		expect(result).toMatchObject({
			type: "Abs",
			body: {
				type: "Block",
				statements: [{ value: { type: "Var", variable: { type: "Foreign", name: "tick" } } }],
				return: { type: "Suspend", payload: { type: "App", func: { type: "Var", variable: { index: 0 } }, arg: { type: "Lit", value: Lit.Num(7) } } },
			},
		});
		expect(compute).toHaveBeenCalledTimes(0);
	});

	it("retains recursive let scopes and rebases dependent statement annotations", () => {
		const source = captured(NF.Constructors.Atom("Num"));
		const term = EB.Constructors.Block(
			[
				EB.Constructors.Stmt.Let("t", variable(1), NF.Type),
				EB.Constructors.Stmt.Let("x", EB.Constructors.App("Explicit", variable(0), variable(1)), NF.Constructors.Rigid(1)),
			],
			EB.Constructors.App("Explicit", variable(0), variable(1)),
		);
		const result = run(term, source, 2);
		expect(result).toMatchObject({
			type: "Block",
			statements: [
				{ value: { type: "Lit", value: Lit.Atom("Num") } },
				{ value: { type: "App", func: { variable: { index: 0 } }, arg: { variable: { index: 1 } } } },
			],
			return: { func: { variable: { index: 0 } }, arg: { variable: { index: 1 } } },
		});

		if (!isMatching({ type: "Block" }, result)) {
			throw new Error("Expected a block");
		}
		const second = result.statements[1];

		if (!isMatching({ type: "Let" }, second)) {
			throw new Error("Expected a let");
		}
		expect(observe(second.annotation)).toMatchObject({ type: "Neutral", value: { type: "Var", variable: { type: "Bound", lvl: 2 } } });
	});

	it("substitutes captured dependencies in semantic annotations", () => {
		const term = EB.Constructors.Block([EB.Constructors.Stmt.Let("x", variable(0), NF.Constructors.Rigid(0))], variable(0));
		const result = run(term, captured(NF.Constructors.Atom("Num")));

		if (!isMatching({ type: "Block" }, result)) {
			throw new Error("Expected a block");
		}
		const first = result.statements[0];

		if (!isMatching({ type: "Let" }, first)) {
			throw new Error("Expected a let");
		}
		expect(observe(first.annotation)).toMatchObject({ type: "Lit", value: Lit.Atom("Num") });
	});

	it("tracks label frames independently from lambda binders", () => {
		const source = EB.open({ labels: ["outer"], scoped: R.Constructors.Empty() }, captured(number(7)));
		const local = EB.Constructors.Var(EB.Constructors.Vars.NuLabel("inner", 0, NF.Type));
		const outer = EB.Constructors.Var(EB.Constructors.Vars.NuLabel("outer", 1, NF.Type));
		const term = EB.Constructors.Nu(
			{ mode: "lazy", labels: ["inner"], scoped: R.Constructors.Row([{ label: "inner", value: variable(0) }]), annotation: EB.Type },
			EB.Constructors.Lambda("x", "Explicit", EB.Constructors.App("Explicit", local, outer), EB.Type),
		);
		const result = run(term, source, 0, source);
		expect(result).toMatchObject({
			type: "Abs",
			binding: { type: "Nu", scoped: { entries: [{ value: { type: "Lit", value: Lit.Num(7) } }] } },
			body: { type: "Abs", body: { func: { variable: { type: "NuLabel", index: 0 } }, arg: { variable: { type: "NuLabel", index: 1 } } } },
		});
	});

	it("closes an escaped field structurally in its defining environment", () => {
		const source = EB.open(
			{ labels: ["field"], scoped: R.Constructors.Row([{ label: "field", value: EB.Constructors.Suspend(EB.Anonymous, variable(0), EB.Type) }]) },
			captured(number(7)),
		);
		const result = run(EB.Constructors.Var(EB.Constructors.Vars.NuLabel("field", 0, NF.Type)), source);
		expect(result).toMatchObject({ type: "Suspend", payload: { type: "Lit", value: Lit.Num(7) } });
	});

	it("preserves pattern binders while closing captured branch references", () => {
		const term = EB.Constructors.Match(variable(0), [
			{
				pattern: EB.Constructors.Patterns.Var("known", variable(0)),
				binders: [
					["a", NF.Type],
					["b", NF.Type],
				],
				term: EB.Constructors.App("Explicit", variable(0), variable(2)),
			},
		]);
		const result = run(term, captured(number(7)));
		expect(result).toMatchObject({
			scrutinee: { type: "Lit", value: Lit.Num(7) },
			alternatives: [
				{ pattern: { term: { type: "Lit", value: Lit.Num(7) } }, term: { func: { variable: { index: 0 } }, arg: { type: "Lit", value: Lit.Num(7) } } },
			],
		});
	});

	it("splices a captured row tail into the preserved entries", () => {
		const source = captured(NF.Constructors.Row(R.Constructors.Row([{ label: "b", value: number(2) }])));
		const term = EB.Constructors.Row(R.Constructors.Row([{ label: "a", value: EB.Constructors.Lit(Lit.Num(1)) }], { type: "Bound", index: 0 }));
		expect(run(term, source)).toMatchObject({
			type: "Row",
			row: {
				entries: [
					{ label: "a", value: { value: Lit.Num(1) } },
					{ label: "b", value: { value: Lit.Num(2) } },
				],
			},
		});
	});
	it("retains nested blocks in returned source terms", () => {
		const term = EB.Constructors.Block([EB.Constructors.Stmt.Expr(EB.Type)], EB.Constructors.Block([], EB.Type));
		expect(run(term, empty)).toMatchObject({
			type: "Block",
			statements: [{ type: "Expression" }],
			return: { type: "Block", statements: [], return: { type: "Lit" } },
		});
	});

	it("preserves local Sigma names while substituting captured labels", () => {
		const label = EB.Constructors.Var({ type: "Label", name: "a" });
		const source = { ...empty, sigma: { a: { value: number(7) } } };
		expect(run(label, source)).toMatchObject({ type: "Lit", value: Lit.Num(7) });
		const term = EB.Constructors.Sigma("row", EB.Constructors.Row(R.Constructors.Row([{ label: "a", value: EB.Type }])), label);
		expect(run(term, source)).toMatchObject({ type: "Abs", body: { type: "Var", variable: { type: "Label", name: "a" } } });
	});

	it("reconstructs the saved field scope around an escaped recursive function", () => {
		const field = EB.Constructors.Var(EB.Constructors.Vars.NuLabel("f", 0, NF.Type));
		const body = EB.Constructors.Match(variable(0), [
			{ pattern: EB.Constructors.Patterns.Lit(Lit.Bool(true)), binders: [], term: EB.Constructors.Lit(Lit.Num(0)) },
			{
				pattern: EB.Constructors.Patterns.Lit(Lit.Bool(false)),
				binders: [],
				term: EB.Constructors.App("Explicit", field, EB.Constructors.Lit(Lit.Bool(true))),
			},
		]);
		const fn = EB.Constructors.Lambda("x", "Explicit", body, EB.Type);
		const binding: Extract<EB.Binding, { type: "Nu" }> = {
			type: "Nu",
			variable: "$nu",
			mode: "lazy",
			labels: ["f"],
			scoped: R.Constructors.Row([{ label: "f", value: fn }]),
			annotation: EB.Type,
		};
		const source = EB.open(binding, empty, binding);
		const result = run(field, source);
		expect(result).toMatchObject({
			type: "Abs",
			binding: {
				type: "Nu",
				mode: "strict",
				scoped: {
					entries: [
						{
							label: "f",
							value: { type: "Abs", body: { type: "Match", alternatives: [{}, { term: { func: { variable: { type: "NuLabel", index: 0 } } } }] } },
						},
					],
				},
			},
			body: { type: "Var", variable: { type: "NuLabel", index: 0 } },
		});
		const application = EB.Constructors.App("Explicit", result, EB.Constructors.Lit(Lit.Bool(false)));
		const [value] = Eff.run(() => NF.normalize(application), [M.reader.handlers(empty), Metas.registry.handlers()]);
		expect(value).toMatchObject({ type: "Lit", value: Lit.Num(0) });
	});
	it("resolves captured semantic labels through their owning source frame", () => {
		const sourceFrame = EB.open({ labels: ["field"], scoped: R.Constructors.Row([{ label: "field", value: EB.Constructors.Lit(Lit.Num(7)) }]) }, empty);
		const source = { ...sourceFrame, env: captured(NF.Constructors.NuLabel("field", 0, NF.Type)).env };
		const unrelated = EB.open({ labels: ["field"], scoped: R.Constructors.Row([{ label: "field", value: EB.Constructors.Lit(Lit.Num(99)) }]) }, empty);
		expect(run(variable(0), source)).toMatchObject({ type: "Lit", value: Lit.Num(7) });
		expect(run(variable(0), source, 0, unrelated)).toMatchObject({ type: "Lit", value: Lit.Num(7) });
		const nested = {
			...sourceFrame,
			env: captured(NF.Constructors.Row(R.Constructors.Row([{ label: "nested", value: NF.Constructors.NuLabel("field", 0, NF.Type) }]))).env,
		};
		expect(run(variable(0), nested)).toMatchObject({ type: "Row", row: { entries: [{ value: { type: "Lit", value: Lit.Num(7) } }] } });
	});

	it("retains captured callable bodies until their pending invocation", () => {
		const compute = vi.fn(() => number(9));
		const context = { ...empty, ffi: { tick: { arity: 0, compute } } };
		const fn = EB.Constructors.Lambda("x", "Explicit", EB.Constructors.Var({ type: "Foreign", name: "tick" }), EB.Type);
		const term = EB.Constructors.Block(
			[EB.Constructors.Stmt.Let("f", fn, NF.Type), EB.Constructors.Stmt.Expr(EB.Constructors.Suspend(EB.Anonymous, EB.Type, EB.Type))],
			EB.Constructors.App("Explicit", variable(0), EB.Type),
		);
		const [pending] = Eff.run(() => NF.normalize(term), [M.reader.handlers(context), Metas.registry.handlers()]);
		Eff.run(() => NF.quote(0, pending), [M.reader.handlers(context), Metas.registry.handlers()]);
		expect(compute).toHaveBeenCalledTimes(0);
		const [value] = Eff.run(() => NF.normalize(fn), [M.reader.handlers(context), Metas.registry.handlers()]);
		const closed = run(variable(0), { ...context, env: captured(value).env });
		const [result] = Eff.run(() => NF.normalize(EB.Constructors.App("Explicit", closed, EB.Type)), [M.reader.handlers(context), Metas.registry.handlers()]);
		expect(result).toMatchObject({ type: "Lit", value: Lit.Num(9) });
		expect(compute).toHaveBeenCalledTimes(1);
	});

	it("retains a recursive function's binding through public quotation", () => {
		const body = EB.Constructors.Match(variable(0), [
			{ pattern: EB.Constructors.Patterns.Lit(Lit.Bool(true)), binders: [], term: EB.Constructors.Lit(Lit.Num(0)) },
			{
				pattern: EB.Constructors.Patterns.Lit(Lit.Bool(false)),
				binders: [],
				term: EB.Constructors.App("Explicit", variable(1), EB.Constructors.Lit(Lit.Bool(true))),
			},
		]);
		const recursive = EB.Constructors.Block([EB.Constructors.Stmt.Let("f", EB.Constructors.Lambda("x", "Explicit", body, EB.Type), NF.Type)], variable(0));
		const [value] = Eff.run(() => NF.normalize(recursive), [M.reader.handlers(empty), Metas.registry.handlers()]);
		const [quoted] = Eff.run(() => NF.quote(0, value), [M.reader.handlers(empty), Metas.registry.handlers()]);
		const [result] = Eff.run(
			() => NF.normalize(EB.Constructors.App("Explicit", quoted, EB.Constructors.Lit(Lit.Bool(false)))),
			[M.reader.handlers(empty), Metas.registry.handlers()],
		);
		expect(result).toMatchObject({ type: "Lit", value: Lit.Num(0) });
	});

	it("retains mutually captured recursive function bindings", () => {
		const first = captured(NF.Type).env[0];
		const second = captured(NF.Type).env[0];
		const context = { ...empty, env: [second, first] };
		const body = EB.Constructors.Match(variable(0), [
			{ pattern: EB.Constructors.Patterns.Lit(Lit.Bool(true)), binders: [], term: EB.Constructors.Lit(Lit.Num(0)) },
			{
				pattern: EB.Constructors.Patterns.Lit(Lit.Bool(false)),
				binders: [],
				term: EB.Constructors.App("Explicit", variable(1), EB.Constructors.Lit(Lit.Bool(true))),
			},
		]);
		first.nf = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure(context, body), NF.Type);
		second.nf = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure(context, EB.Constructors.App("Explicit", variable(2), variable(0))), NF.Type);
		const quoted = run(variable(1), context);
		const [result] = Eff.run(
			() => NF.normalize(EB.Constructors.App("Explicit", quoted, EB.Constructors.Lit(Lit.Bool(false)))),
			[M.reader.handlers(empty), Metas.registry.handlers()],
		);
		expect(result).toMatchObject({ type: "Lit", value: Lit.Num(0) });
	});
	it("retains the operation signature during structural semantic readback", () => {
		const suspended = NF.Constructors.Suspend(NF.Constructors.Atom("$anonymous"), NF.Type, NF.Type, NF.Constructors.Atom("Signature"));
		const [term] = Eff.run(
			() => drive(readValue(0, { ctx: empty, value: suspended }), () => "Readback exhausted its fuel"),
			[M.reader.handlers(empty), Metas.registry.handlers(), Mode.handlers(defaultMode), handlers<Scope, EB.Term, Handling>(10000)],
		);
		expect(term).toMatchObject({ type: "Suspend", identity: { type: "Ann", ann: { type: "Lit", value: Lit.Atom("Signature") } } });
	});
});
