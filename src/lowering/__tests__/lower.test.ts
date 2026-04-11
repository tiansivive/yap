import { describe, it, expect, beforeEach } from "vitest";

import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";

import * as Sub from "@yap/elaboration/unification/substitution";

import { lower, lowerToMir } from "../lower";
import { mkCtx, resetSupply } from "../context";
import * as Pretty from "../pretty";

const emptyDisplayCtx: EB.DisplayContext = { env: [], zonker: Sub.empty, metas: {} };

describe("Lowering: primitives and ops", () => {
	beforeEach(() => resetSupply());

	it("lowers Lit(Num(42))", () => {
		const term = EB.DSL.num(42);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers Var(Bound 0) with env", () => {
		const term = EB.DSL.bound(0);
		const ctx = mkCtx({ bound: [[0, "x"]] });
		const { instrs, value } = lower(term, ctx);
		expect(instrs).toHaveLength(0);
		expect(value).toBe("x");
	});

	it("lowers Var(Free n) with env", () => {
		const term = EB.DSL.free("foo");
		const ctx = mkCtx({ free: [["foo", "x"]] });
		const { instrs, value } = lower(term, ctx);
		expect(instrs).toHaveLength(0);
		expect(value).toBe("x");
	});

	it("lowers add(1, 2)", () => {
		const term = EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers not(true)", () => {
		const term = EB.DSL.not(EB.DSL.bool(true));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers Lambda (closure)", () => {
		const term = EB.DSL.lambda("x", EB.DSL.num(1), EB.DSL.type("Num"));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers nested Lambda", () => {
		const term = EB.DSL.lambda("x", EB.DSL.lambda("y", EB.DSL.bound(1), EB.DSL.type("Num")), EB.DSL.type("Num"));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers λx.x (identity, closed)", () => {
		const term = EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num"));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers (λx.x) 42 (indirect call)", () => {
		const term = EB.DSL.app(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num")), EB.DSL.num(42));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers (λx.λy.x) 1 2 (curried const)", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.bound(1), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(1)), EB.DSL.num(2));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers (λx.λy.x+y) 1 2 (curried closure with capture)", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(1)), EB.DSL.num(2));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("throws for Var(Foreign) used as value", () => {
		const term = EB.DSL.foreign("$add");
		const ctx = mkCtx();
		expect(() => lower(term, ctx)).toThrow(/Primitive.*used as value/);
	});
});

describe("Lowering: struct, proj, inj", () => {
	beforeEach(() => resetSupply());

	it("lowers struct({ x: 1, y: 2 })", () => {
		const term = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers proj(label, struct)", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers inj(label, value, struct)", () => {
		const base = EB.DSL.struct([{ label: "x", value: EB.DSL.num(1) }]);
		const term = EB.DSL.inj("y", EB.DSL.num(2), base);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers empty struct", () => {
		const term = EB.DSL.struct([]);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers proj from bound var", () => {
		const term = EB.DSL.proj("x", EB.DSL.bound(0));
		const ctx = mkCtx({ bound: [[0, "r"]] });
		const { instrs, value } = lower(term, ctx);
		expect(instrs).toHaveLength(1);
		expect(instrs[0]).toMatchObject({ type: "Read", label: "x", target: "r" });
		expect(value).toBeDefined();
	});
});

describe("Lowering: match", () => {
	beforeEach(() => resetSupply());

	it("lowers match on variant (Some/None)", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.str("Some") },
			{ label: "Some", value: EB.DSL.num(42) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers match on struct (field bindings)", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		const row = R.Constructors.Extension(
			"x",
			EB.Constructors.Patterns.Binder("a"),
			R.Constructors.Extension("y", EB.Constructors.Patterns.Binder("b"), R.Constructors.Empty() as R.Row<EB.Pattern, string>),
		);
		const term = EB.DSL.match(scrutinee, [{ pattern: EB.Constructors.Patterns.Struct(row), term: EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1)) }]);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers match on struct + variable ({ foo: 1 } -> 1 | o -> 0)", () => {
		const scrutinee = EB.DSL.struct([{ label: "foo", value: EB.DSL.num(1) }]);
		const structRow = R.Constructors.Extension("foo", EB.Constructors.Patterns.Lit(Lit.Num(1)), R.Constructors.Empty() as R.Row<EB.Pattern, string>);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.Constructors.Patterns.Struct(structRow), term: EB.DSL.num(1) },
			{ pattern: EB.Constructors.Patterns.Binder("o"), term: EB.DSL.num(0) },
		]);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers match on literals (42, 0, wildcard)", () => {
		const scrutinee = EB.DSL.num(42);
		const alts = [
			{ pattern: EB.Constructors.Patterns.Lit(Lit.Num(42)), term: EB.DSL.num(1) },
			{ pattern: EB.Constructors.Patterns.Lit(Lit.Num(0)), term: EB.DSL.num(0) },
			{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(-1) },
		];
		const term = EB.Constructors.Match(
			scrutinee,
			alts.map(({ pattern, term: t }) => EB.Constructors.Alternative(pattern, t, [])),
		);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers match on struct with literal patterns (x: 1 vs x: 2)", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(10) },
		]);
		const dummyBinder: [string, EB.NF.Value] = ["_", EB.NF.Constructors.Lit(Lit.Atom("Num"))];
		const row1 = R.Constructors.Extension(
			"x",
			EB.Constructors.Patterns.Lit(Lit.Num(1)),
			R.Constructors.Extension("y", EB.Constructors.Patterns.Binder("b"), R.Constructors.Empty() as R.Row<EB.Pattern, string>),
		);
		const row2 = R.Constructors.Extension(
			"x",
			EB.Constructors.Patterns.Lit(Lit.Num(2)),
			R.Constructors.Extension("y", EB.Constructors.Patterns.Binder("b"), R.Constructors.Empty() as R.Row<EB.Pattern, string>),
		);
		const row3 = R.Constructors.Extension(
			"x",
			EB.Constructors.Patterns.Binder("a"),
			R.Constructors.Extension("y", EB.Constructors.Patterns.Binder("b"), R.Constructors.Empty() as R.Row<EB.Pattern, string>),
		);
		const term = EB.Constructors.Match(scrutinee, [
			EB.Constructors.Alternative(EB.Constructors.Patterns.Struct(row1), EB.DSL.bound(0), [dummyBinder]),
			EB.Constructors.Alternative(EB.Constructors.Patterns.Struct(row2), EB.DSL.add(EB.DSL.bound(0), EB.DSL.num(1)), [dummyBinder]),
			EB.Constructors.Alternative(EB.Constructors.Patterns.Struct(row3), EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1)), [dummyBinder, dummyBinder]),
		]);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers match on variant with struct payload (Some(Point))", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.str("Some") },
			{
				label: "Some",
				value: EB.DSL.struct([
					{ label: "x", value: EB.DSL.num(1) },
					{ label: "y", value: EB.DSL.num(2) },
				]),
			},
		]);
		const payloadRow = R.Constructors.Extension(
			"x",
			EB.Constructors.Patterns.Lit(Lit.Num(1)),
			R.Constructors.Extension("y", EB.Constructors.Patterns.Binder("b"), R.Constructors.Empty() as R.Row<EB.Pattern, string>),
		);
		const variantPat = EB.Constructors.Patterns.Variant(
			R.Constructors.Extension("Some", EB.Constructors.Patterns.Struct(payloadRow), R.Constructors.Empty() as R.Row<EB.Pattern, string>),
		);
		const dummyBinder: [string, EB.NF.Value] = ["_", EB.NF.Constructors.Lit(Lit.Atom("Num"))];
		const term = EB.Constructors.Match(scrutinee, [
			EB.Constructors.Alternative(variantPat, EB.DSL.bound(0), [dummyBinder]),
			EB.Constructors.Alternative(EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), EB.DSL.num(0), [dummyBinder]),
		]);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers Block (let x=1; let y=2; add(x,y))", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [EB.Constructors.Stmt.Let("x", EB.DSL.num(1), numTy), EB.Constructors.Stmt.Let("y", EB.DSL.num(2), numTy)];
		const returnTerm = EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1));
		const block = EB.Constructors.Block(stmts, returnTerm);
		const mod = lowerToMir(block);
		expect({ term: EB.Display.Term(block, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers reset(shift(λk. k 42)) — resume returns 42", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		const term = EB.Constructors.Reset(EB.Constructors.Shift(body));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers reset(42) — no shift", () => {
		const term = EB.Constructors.Reset(EB.DSL.num(42));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers reset(shift k -> 42) — shift returns without resuming", () => {
		const body = EB.DSL.lambda("k", EB.DSL.num(42), EB.DSL.type("Num"));
		const term = EB.Constructors.Reset(EB.Constructors.Shift(body));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers reset(shift k -> (k 1) + (k 2)) — multishot", () => {
		const body = EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))), EB.DSL.type("Num"));
		const term = EB.Constructors.Reset(EB.Constructors.Shift(body));
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers reset(Block) with captured frame — let x=1; shift k->k 10; x+100", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [
			EB.Constructors.Stmt.Let("x", EB.DSL.num(1), numTy),
			EB.Constructors.Stmt.Expr(EB.Constructors.Shift(EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(10)), EB.DSL.type("Num")))),
		];
		const returnTerm = EB.DSL.add(EB.DSL.bound(0), EB.DSL.num(100));
		const block = EB.Constructors.Block(stmts, returnTerm);
		const term = EB.Constructors.Reset(block);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers reset(Block) — continuation uses resumption value and captured var (let v = shift; add(v, x))", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [
			EB.Constructors.Stmt.Let("x", EB.DSL.num(7), numTy),
			EB.Constructors.Stmt.Let("v", EB.Constructors.Shift(EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(99)), EB.DSL.type("Num"))), numTy),
		];
		// return: add(v, x) where v=resumption (index 0), x=captured (index 1)
		const returnTerm = EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1));
		const block = EB.Constructors.Block(stmts, returnTerm);
		const term = EB.Constructors.Reset(block);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});

	it("lowers match on nested struct with literal patterns", () => {
		const inner = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		const scrutinee = EB.DSL.struct([{ label: "outer", value: inner }]);
		const innerRow = R.Constructors.Extension(
			"x",
			EB.Constructors.Patterns.Lit(Lit.Num(1)),
			R.Constructors.Extension("y", EB.Constructors.Patterns.Binder("b"), R.Constructors.Empty() as R.Row<EB.Pattern, string>),
		);
		const outerRow = R.Constructors.Extension("outer", EB.Constructors.Patterns.Struct(innerRow), R.Constructors.Empty() as R.Row<EB.Pattern, string>);
		const bBinder: [string, EB.NF.Value] = ["b", EB.NF.Constructors.Lit(Lit.Atom("Num"))];
		const term = EB.Constructors.Match(scrutinee, [EB.Constructors.Alternative(EB.Constructors.Patterns.Struct(outerRow), EB.DSL.bound(0), [bBinder])]);
		const mod = lowerToMir(term);
		expect({ term: EB.Display.Term(term, emptyDisplayCtx), mir: Pretty.display.module(mod) }).toMatchSnapshot();
	});
});
