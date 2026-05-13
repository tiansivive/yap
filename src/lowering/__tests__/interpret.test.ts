import { describe, it, expect, beforeEach, vi } from "vitest";

import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";

import { lowerToMir } from "../lower";
import { resetSupply } from "../context";
import { interpret, type Value } from "../interpret";
import type { Declaration } from "../mir";

const run = (term: EB.Term, ffi?: Record<string, (...args: any[]) => any>, declarations?: Map<string, Declaration>): Value =>
	interpret(lowerToMir(term, declarations), ffi);

describe("Interpret: primitives and ops", () => {
	beforeEach(() => resetSupply());

	it("Lit(42) => 42", () => {
		expect(run(EB.DSL.num(42))).toBe(42);
	});

	it("Lit(true) => true", () => {
		expect(run(EB.DSL.bool(true))).toBe(true);
	});

	it('Lit("hello") => "hello"', () => {
		expect(run(EB.DSL.str("hello"))).toBe("hello");
	});

	it("add(1, 2) => 3", () => {
		expect(run(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)))).toBe(3);
	});

	it("sub(10, 3) => 7", () => {
		const term = EB.DSL.app(EB.DSL.app(EB.DSL.foreign("$sub"), EB.DSL.num(10)), EB.DSL.num(3));
		expect(run(term)).toBe(7);
	});

	it("not(true) => false", () => {
		expect(run(EB.DSL.not(EB.DSL.bool(true)))).toBe(false);
	});

	it("not(false) => true", () => {
		expect(run(EB.DSL.not(EB.DSL.bool(false)))).toBe(true);
	});

	it("eq(1, 1) => true", () => {
		const term = EB.DSL.app(EB.DSL.app(EB.DSL.foreign("$eq"), EB.DSL.num(1)), EB.DSL.num(1));
		expect(run(term)).toBe(true);
	});

	it("eq(1, 2) => false", () => {
		const term = EB.DSL.app(EB.DSL.app(EB.DSL.foreign("$eq"), EB.DSL.num(1)), EB.DSL.num(2));
		expect(run(term)).toBe(false);
	});
});

describe("Interpret: lambda and application", () => {
	beforeEach(() => resetSupply());

	it("(λx.x) 42 => 42 (identity)", () => {
		const term = EB.DSL.app(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num")), EB.DSL.num(42));
		expect(run(term)).toBe(42);
	});

	it("(λx.x+1) 41 => 42", () => {
		const body = EB.DSL.add(EB.DSL.bound(0), EB.DSL.num(1));
		const term = EB.DSL.app(EB.DSL.lambda("x", body, EB.DSL.type("Num")), EB.DSL.num(41));
		expect(run(term)).toBe(42);
	});

	it("(λx.λy.x) 1 2 => 1 (const)", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.bound(1), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(1)), EB.DSL.num(2));
		expect(run(term)).toBe(1);
	});

	it("(λx.λy.x+y) 3 4 => 7 (curried add with capture)", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(3)), EB.DSL.num(4));
		expect(run(term)).toBe(7);
	});
});

describe("Interpret: struct, proj, inj", () => {
	beforeEach(() => resetSupply());

	it("struct({ x: 1, y: 2 }) => { x: 1, y: 2 }", () => {
		const term = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		expect(run(term)).toEqual({ x: 1, y: 2 });
	});

	it("proj('x', struct({ x: 42 })) => 42", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		expect(run(term)).toBe(42);
	});

	it("inj('y', 2, struct({ x: 1 })) => { x: 1, y: 2 }", () => {
		const base = EB.DSL.struct([{ label: "x", value: EB.DSL.num(1) }]);
		const term = EB.DSL.inj("y", EB.DSL.num(2), base);
		expect(run(term)).toEqual({ x: 1, y: 2 });
	});

	it("empty struct => {}", () => {
		expect(run(EB.DSL.struct([]))).toEqual({});
	});

	it("(λr. r.x) struct({ x: 99 }) => 99", () => {
		const lam = EB.DSL.lambda("r", EB.DSL.proj("x", EB.DSL.bound(0)), EB.DSL.type("Num"));
		const term = EB.DSL.app(lam, EB.DSL.struct([{ label: "x", value: EB.DSL.num(99) }]));
		expect(run(term)).toBe(99);
	});
});

describe("Interpret: block", () => {
	beforeEach(() => resetSupply());

	it("let x=1; let y=2; x+y => 3", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [EB.Constructors.Stmt.Let("x", EB.DSL.num(1), numTy), EB.Constructors.Stmt.Let("y", EB.DSL.num(2), numTy)];
		const ret = EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1));
		expect(run(EB.Constructors.Block(stmts, ret))).toBe(3);
	});
});

describe("Interpret: match", () => {
	beforeEach(() => resetSupply());

	it("match on variant (Some 42) => 42", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.str("Some") },
			{ label: "Some", value: EB.DSL.num(42) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		expect(run(term)).toBe(42);
	});

	it("match on variant (None) => 0", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.str("None") },
			{ label: "None", value: EB.DSL.num(0) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		expect(run(term)).toBe(0);
	});

	it("match on struct fields ({ x: a, y: b } => a + b)", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(3) },
			{ label: "y", value: EB.DSL.num(4) },
		]);
		const row = R.Constructors.Extension(
			"x",
			EB.Constructors.Patterns.Binder("a"),
			R.Constructors.Extension("y", EB.Constructors.Patterns.Binder("b"), R.Constructors.Empty() as R.Row<EB.Pattern, string>),
		);
		const term = EB.DSL.match(scrutinee, [{ pattern: EB.Constructors.Patterns.Struct(row), term: EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1)) }]);
		expect(run(term)).toBe(7);
	});

	it("match on literals (42 => 1, 0 => 0, _ => -1)", () => {
		const mkMatch = (n: number) => {
			const alts = [
				{ pattern: EB.Constructors.Patterns.Lit(Lit.Num(42)), term: EB.DSL.num(1) },
				{ pattern: EB.Constructors.Patterns.Lit(Lit.Num(0)), term: EB.DSL.num(0) },
				{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(-1) },
			];
			return EB.Constructors.Match(
				EB.DSL.num(n),
				alts.map(({ pattern, term: t }) => EB.Constructors.Alternative(pattern, t, [])),
			);
		};
		expect(run(mkMatch(42))).toBe(1);
		expect(run(mkMatch(0))).toBe(0);
		expect(run(mkMatch(99))).toBe(-1);
	});
});

describe("Interpret: shift/reset", () => {
	beforeEach(() => resetSupply());

	it("reset(42) => 42 (no shift)", () => {
		expect(run(EB.Constructors.Reset(EB.DSL.num(42)))).toBe(42);
	});

	it("reset(shift k -> 42) => 42 (shift without resume)", () => {
		const body = EB.DSL.lambda("k", EB.DSL.num(42), EB.DSL.type("Num"));
		expect(run(EB.Constructors.Reset(EB.Constructors.Shift(body)))).toBe(42);
	});

	it("reset(shift k -> k 42) => 42 (single resume)", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		expect(run(EB.Constructors.Reset(EB.Constructors.Shift(body)))).toBe(42);
	});

	it("reset(shift k -> (k 1) + (k 2)) => 3 (multishot)", () => {
		const body = EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))), EB.DSL.type("Num"));
		expect(run(EB.Constructors.Reset(EB.Constructors.Shift(body)))).toBe(3);
	});

	it("reset { let x=10; shift k->k 1+k 2; x } => 20 (multishot with rest-of-reset)", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const shiftBody = EB.DSL.lambda(
			"k",
			EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))),
			EB.DSL.type("Num"),
		);
		const stmts: EB.Statement[] = [EB.Constructors.Stmt.Let("x", EB.DSL.num(10), numTy), EB.Constructors.Stmt.Expr(EB.Constructors.Shift(shiftBody))];
		const block = EB.Constructors.Block(stmts, EB.DSL.bound(0));
		expect(run(EB.Constructors.Reset(block))).toBe(20);
	});

	it("reset { let x=1; shift k->k 10; x+100 } => 101 (captured frame)", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [
			EB.Constructors.Stmt.Let("x", EB.DSL.num(1), numTy),
			EB.Constructors.Stmt.Expr(EB.Constructors.Shift(EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(10)), EB.DSL.type("Num")))),
		];
		const block = EB.Constructors.Block(stmts, EB.DSL.add(EB.DSL.bound(0), EB.DSL.num(100)));
		expect(run(EB.Constructors.Reset(block))).toBe(101);
	});

	it("reset { let x=7; let v = shift k->k 99; v+x } => 106 (resumption value + captured var)", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [
			EB.Constructors.Stmt.Let("x", EB.DSL.num(7), numTy),
			EB.Constructors.Stmt.Let("v", EB.Constructors.Shift(EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(99)), EB.DSL.type("Num"))), numTy),
		];
		const block = EB.Constructors.Block(stmts, EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1)));
		expect(run(EB.Constructors.Reset(block))).toBe(106);
	});

	it("reset { let x=5; let v = shift k-> k 10 + k 20; v+x } (multishot with captured var)", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [
			EB.Constructors.Stmt.Let("x", EB.DSL.num(5), numTy),
			EB.Constructors.Stmt.Let(
				"v",
				EB.Constructors.Shift(
					EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(10)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(20))), EB.DSL.type("Num")),
				),
				numTy,
			),
		];
		const block = EB.Constructors.Block(stmts, EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1)));
		const term = EB.Constructors.Reset(block);
		// k 10 => v=10, v+x = 10+5 = 15
		// k 20 => v=20, v+x = 20+5 = 25
		// 15 + 25 = 40
		expect(run(term)).toBe(40);
	});
});

describe("Interpret: FFI", () => {
	beforeEach(() => resetSupply());

	it("saturated FFI call — print('hello')", () => {
		const log = vi.fn((_x: any) => "unit");
		const declarations = new Map([["print", { name: "print", arity: 1, source: "ffi" as const }]]);
		const term = EB.DSL.app(EB.DSL.foreign("print"), EB.DSL.str("hello"));
		const result = run(term, { print: log }, declarations);
		expect(log).toHaveBeenCalledWith("hello");
		expect(result).toBe("unit");
	});

	it("partially applied FFI — write(fd)(msg)", () => {
		const writeFn = vi.fn((fd: number, msg: string) => "unit");
		const declarations = new Map([["write", { name: "write", arity: 2, source: "ffi" as const }]]);
		const partial = EB.DSL.app(EB.DSL.foreign("write"), EB.DSL.num(1));
		const term = EB.DSL.app(partial, EB.DSL.str("hi"));
		const result = run(term, { write: writeFn }, declarations);
		expect(writeFn).toHaveBeenCalledWith(1, "hi");
		expect(result).toBe("unit");
	});

	it("FFI inside lambda — λx. print(x)", () => {
		const log = vi.fn((x: any) => x);
		const declarations = new Map([["print", { name: "print", arity: 1, source: "ffi" as const }]]);
		const lam = EB.DSL.lambda("x", EB.DSL.app(EB.DSL.foreign("print"), EB.DSL.bound(0)), EB.DSL.type("Str"));
		const term = EB.DSL.app(lam, EB.DSL.str("world"));
		const result = run(term, { print: log }, declarations);
		expect(log).toHaveBeenCalledWith("world");
		expect(result).toBe("world");
	});
});
