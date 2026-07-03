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
import { Runtime } from "../runtime";

const emitC = (term: EB.Term, declarations?: Map<string, Declaration>) => print(emit(lowerToMir(term, declarations)));

describe("C Codegen: snapshot tests", () => {
	beforeEach(() => resetSupply());

	it("Lit(42)", () => {
		expect(emitC(EB.DSL.num(42))).toMatchSnapshot();
	});

	it("Lit(true)", () => {
		expect(emitC(EB.DSL.bool(true))).toMatchSnapshot();
	});

	it('Lit("hello")', () => {
		expect(emitC(EB.DSL.str("hello"))).toMatchSnapshot();
	});

	it("add(1, 2)", () => {
		expect(emitC(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)))).toMatchSnapshot();
	});

	it("not(true)", () => {
		expect(emitC(EB.DSL.not(EB.DSL.bool(true)))).toMatchSnapshot();
	});

	it("(λx.x) 42 — identity", () => {
		const term = EB.DSL.app(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num")), EB.DSL.num(42));
		expect(emitC(term)).toMatchSnapshot();
	});

	it("(λx.λy.x+y) 3 4 — curried closure", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(3)), EB.DSL.num(4));
		expect(emitC(term)).toMatchSnapshot();
	});

	it("struct({ x: 1, y: 2 })", () => {
		const term = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		expect(emitC(term)).toMatchSnapshot();
	});

	it("proj('x', struct({ x: 42 }))", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		expect(emitC(term)).toMatchSnapshot();
	});

	it("match on variant (Some 42)", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.type("Some") },
			{ label: "payload", value: EB.DSL.num(42) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		expect(emitC(term)).toMatchSnapshot();
	});

	it("reset(shift k -> k 42) — single resume", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		expect(emitC(EB.Constructors.Reset(EB.Constructors.Shift(body)))).toMatchSnapshot();
	});

	it("reset(shift k -> (k 1) + (k 2)) — multishot", () => {
		const body = EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))), EB.DSL.type("Num"));
		expect(emitC(EB.Constructors.Reset(EB.Constructors.Shift(body)))).toMatchSnapshot();
	});
});

const compileAndRun = (term: EB.Term, declarations?: Map<string, Declaration>): string => {
	const code = emitC(term, declarations);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yap-c-"));
	const srcPath = path.join(dir, "test.c");
	const binPath = path.join(dir, "test");
	Runtime.copy(dir);
	fs.writeFileSync(srcPath, code);
	try {
		execSync(`gcc -o "${binPath}" "${srcPath}" -lm`, { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
	} catch (e: any) {
		throw new Error(`gcc failed:\n${e.stderr || e.stdout || e.message}`);
	}
	const stdout = execSync(`"${binPath}"`, { encoding: "utf-8", timeout: 5000 });
	return stdout.trim();
};

describe.runIf(process.env.RUN_C_TESTS)("C Codegen: integration tests (gcc)", () => {
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

	it("(λx.x) 42 => 42", () => {
		const term = EB.DSL.app(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num")), EB.DSL.num(42));
		expect(compileAndRun(term)).toBe("42");
	});

	it("(λx.x+1) 41 => 42", () => {
		const body = EB.DSL.add(EB.DSL.bound(0), EB.DSL.num(1));
		const term = EB.DSL.app(EB.DSL.lambda("x", body, EB.DSL.type("Num")), EB.DSL.num(41));
		expect(compileAndRun(term)).toBe("42");
	});

	it("(λx.λy.x) 1 2 => 1", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.bound(1), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(1)), EB.DSL.num(2));
		expect(compileAndRun(term)).toBe("1");
	});

	it("(λx.λy.x+y) 3 4 => 7", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(3)), EB.DSL.num(4));
		expect(compileAndRun(term)).toBe("7");
	});

	it("struct({ x: 1, y: 2 })", () => {
		const term = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		expect(compileAndRun(term)).toBe("{x: 1, y: 2}");
	});

	it("proj('x', struct({ x: 42 })) => 42", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		expect(compileAndRun(term)).toBe("42");
	});

	it("empty struct => {}", () => {
		expect(compileAndRun(EB.DSL.struct([]))).toBe("{}");
	});

	it("let x=1; let y=2; x+y => 3", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [EB.Constructors.Stmt.Let("x", EB.DSL.num(1), numTy), EB.Constructors.Stmt.Let("y", EB.DSL.num(2), numTy)];
		const ret = EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1));
		expect(compileAndRun(EB.Constructors.Block(stmts, ret))).toBe("3");
	});

	it("match on variant (Some 42) => 42", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.type("Some") },
			{ label: "payload", value: EB.DSL.num(42) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		expect(compileAndRun(term)).toBe("42");
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
		expect(compileAndRun(mkMatch(42))).toBe("1");
		expect(compileAndRun(mkMatch(0))).toBe("0");
		expect(compileAndRun(mkMatch(99))).toBe("-1");
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
