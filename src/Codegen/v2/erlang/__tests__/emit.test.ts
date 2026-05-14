import { describe, it, expect, beforeEach } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as NF from "@yap/elaboration/normalization";

import { lowerToMir } from "../../../../lowering/lower";
import { resetSupply } from "../../../../lowering/context";
import type { Declaration } from "../../../../lowering/mir";
import { emit } from "../emit";
import { print } from "../print";

const emitErl = (term: EB.Term, declarations?: Map<string, Declaration>) => print(emit(lowerToMir(term, declarations)));

describe("Erlang Codegen: snapshot tests", () => {
	beforeEach(() => resetSupply());

	it("Lit(42)", () => {
		expect(emitErl(EB.DSL.num(42))).toMatchSnapshot();
	});

	it("Lit(true)", () => {
		expect(emitErl(EB.DSL.bool(true))).toMatchSnapshot();
	});

	it('Lit("hello")', () => {
		expect(emitErl(EB.DSL.str("hello"))).toMatchSnapshot();
	});

	it("add(1, 2)", () => {
		expect(emitErl(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)))).toMatchSnapshot();
	});

	it("not(true)", () => {
		expect(emitErl(EB.DSL.not(EB.DSL.bool(true)))).toMatchSnapshot();
	});

	it("(lam x.x) 42 — identity", () => {
		const term = EB.DSL.app(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num")), EB.DSL.num(42));
		expect(emitErl(term)).toMatchSnapshot();
	});

	it("(lam x.lam y.x+y) 3 4 — curried closure", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(3)), EB.DSL.num(4));
		expect(emitErl(term)).toMatchSnapshot();
	});

	it("struct({ x: 1, y: 2 })", () => {
		const term = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		expect(emitErl(term)).toMatchSnapshot();
	});

	it("proj('x', struct({ x: 42 }))", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		expect(emitErl(term)).toMatchSnapshot();
	});

	it("match on variant (Some 42)", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.str("Some") },
			{ label: "Some", value: EB.DSL.num(42) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		expect(emitErl(term)).toMatchSnapshot();
	});

	it("reset(shift k -> k 42) — single resume", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		expect(emitErl(EB.Constructors.Reset(EB.Constructors.Shift(body)))).toMatchSnapshot();
	});

	it("reset(shift k -> (k 1) + (k 2)) — multishot", () => {
		const body = EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))), EB.DSL.type("Num"));
		expect(emitErl(EB.Constructors.Reset(EB.Constructors.Shift(body)))).toMatchSnapshot();
	});
});

const compileAndRun = (term: EB.Term, declarations?: Map<string, Declaration>): string => {
	const code = emitErl(term, declarations);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yap-erl-"));
	const srcPath = path.join(dir, "yap_main.core");
	fs.writeFileSync(srcPath, code);
	try {
		execSync(`erlc +from_core "${srcPath}"`, { cwd: dir, encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
	} catch (e: any) {
		throw new Error(`erlc failed:\n${e.stderr || e.stdout || e.message}`);
	}
	const stdout = execSync(`erl -noshell -s yap_main main -s init stop`, { cwd: dir, encoding: "utf-8", timeout: 5000 });
	return stdout.trim();
};

describe.runIf(process.env.RUN_ERLANG_TESTS)("Erlang Codegen: integration tests (erlc)", () => {
	beforeEach(() => resetSupply());

	it("Lit(42) => 42", () => {
		expect(compileAndRun(EB.DSL.num(42))).toBe("42");
	});

	it("Lit(true) => true", () => {
		expect(compileAndRun(EB.DSL.bool(true))).toBe("true");
	});

	it('Lit("hello") => "hello"', () => {
		expect(compileAndRun(EB.DSL.str("hello"))).toBe('"hello"');
	});

	it("add(1, 2) => 3", () => {
		expect(compileAndRun(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)))).toBe("3");
	});

	it("sub(10, 3) => 7", () => {
		const term = EB.DSL.app(EB.DSL.app(EB.DSL.foreign("$sub"), EB.DSL.num(10)), EB.DSL.num(3));
		expect(compileAndRun(term)).toBe("7");
	});

	it("not(true) => false", () => {
		expect(compileAndRun(EB.DSL.not(EB.DSL.bool(true)))).toBe("false");
	});

	it("eq(1, 1) => true", () => {
		const term = EB.DSL.app(EB.DSL.app(EB.DSL.foreign("$eq"), EB.DSL.num(1)), EB.DSL.num(1));
		expect(compileAndRun(term)).toBe("true");
	});

	it("(lam x.x) 42 => 42", () => {
		const term = EB.DSL.app(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num")), EB.DSL.num(42));
		expect(compileAndRun(term)).toBe("42");
	});

	it("(lam x.x+1) 41 => 42", () => {
		const body = EB.DSL.add(EB.DSL.bound(0), EB.DSL.num(1));
		const term = EB.DSL.app(EB.DSL.lambda("x", body, EB.DSL.type("Num")), EB.DSL.num(41));
		expect(compileAndRun(term)).toBe("42");
	});

	it("(lam x.lam y.x) 1 2 => 1", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.bound(1), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(1)), EB.DSL.num(2));
		expect(compileAndRun(term)).toBe("1");
	});

	it("(lam x.lam y.x+y) 3 4 => 7", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(3)), EB.DSL.num(4));
		expect(compileAndRun(term)).toBe("7");
	});

	it("proj('x', struct({ x: 42 })) => 42", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		expect(compileAndRun(term)).toBe("42");
	});

	it("let x=1; let y=2; x+y => 3", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [EB.Constructors.Stmt.Let("x", EB.DSL.num(1), numTy), EB.Constructors.Stmt.Let("y", EB.DSL.num(2), numTy)];
		const ret = EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1));
		expect(compileAndRun(EB.Constructors.Block(stmts, ret))).toBe("3");
	});

	it("match on variant (Some 42) => 42", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.str("Some") },
			{ label: "Some", value: EB.DSL.num(42) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		expect(compileAndRun(term)).toBe("42");
	});

	it("reset(42) => 42", () => {
		expect(compileAndRun(EB.Constructors.Reset(EB.DSL.num(42)))).toBe("42");
	});

	it("reset(shift k -> 42) => 42", () => {
		const body = EB.DSL.lambda("k", EB.DSL.num(42), EB.DSL.type("Num"));
		expect(compileAndRun(EB.Constructors.Reset(EB.Constructors.Shift(body)))).toBe("42");
	});

	it("reset(shift k -> k 42) => 42", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		expect(compileAndRun(EB.Constructors.Reset(EB.Constructors.Shift(body)))).toBe("42");
	});

	it("reset(shift k -> (k 1) + (k 2)) => 3", () => {
		const body = EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))), EB.DSL.type("Num"));
		expect(compileAndRun(EB.Constructors.Reset(EB.Constructors.Shift(body)))).toBe("3");
	});

	it("reset { let x=1; shift k->k 10; x+100 } => 101", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [
			EB.Constructors.Stmt.Let("x", EB.DSL.num(1), numTy),
			EB.Constructors.Stmt.Expr(EB.Constructors.Shift(EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(10)), EB.DSL.type("Num")))),
		];
		const block = EB.Constructors.Block(stmts, EB.DSL.add(EB.DSL.bound(0), EB.DSL.num(100)));
		expect(compileAndRun(EB.Constructors.Reset(block))).toBe("101");
	});
});
