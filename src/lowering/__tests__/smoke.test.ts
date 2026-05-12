import { describe, it, expect, beforeEach } from "vitest";

import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";
import * as NF from "@yap/elaboration/normalization";

import { lowerToMir } from "../lower";
import { resetSupply } from "../context";
import * as Pretty from "../pretty";

describe("Lowering v2 (monadic)", () => {
	beforeEach(() => resetSupply());

	it("lowers Lit(Num(42))", () => {
		const mod = lowerToMir(EB.DSL.num(42));
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("lowers add(1, 2)", () => {
		const mod = lowerToMir(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)));
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("lowers not(true)", () => {
		const mod = lowerToMir(EB.DSL.not(EB.DSL.bool(true)));
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("lowers λx.x (identity)", () => {
		const mod = lowerToMir(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num")));
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("lowers (λx.x) 42 (indirect call)", () => {
		const term = EB.DSL.app(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num")), EB.DSL.num(42));
		const mod = lowerToMir(term);
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("lowers (λx.λy.x) 1 2 (curried const, closure capture)", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.bound(1), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(1)), EB.DSL.num(2));
		const mod = lowerToMir(term);
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("lowers reset(shift(λk. k 42)) — resume returns 42", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		const term = EB.Constructors.Reset(EB.Constructors.Shift(body));
		const mod = lowerToMir(term);
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("lowers reset(42) — no shift", () => {
		const term = EB.Constructors.Reset(EB.DSL.num(42));
		const mod = lowerToMir(term);
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("lowers reset(shift k -> 42) — shift returns without resuming", () => {
		const body = EB.DSL.lambda("k", EB.DSL.num(42), EB.DSL.type("Num"));
		const term = EB.Constructors.Reset(EB.Constructors.Shift(body));
		const mod = lowerToMir(term);
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("lowers reset(shift k -> (k 1) + (k 2)) — multishot", () => {
		const body = EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))), EB.DSL.type("Num"));
		const term = EB.Constructors.Reset(EB.Constructors.Shift(body));
		const mod = lowerToMir(term);
		expect(Pretty.display.module(mod)).toMatchSnapshot();
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
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("lowers reset { let a = 5; let f = \\p -> p + a; let v = shift k -> k a + k (f a); v + a }. — captures multiple variables, multiple resumptions", () => {
		// TODO(let-rec): yap's `let` is semantically let-rec, but the lowering currently
		// treats it as non-rec (see TODO in v2/lower.ts:lowerBlock). When we fix that, the
		// indices below need to shift to account for the let-bound name being in scope of
		// its own value. Reference indices under each interpretation:
		//
		//   non-rec (CURRENT):
		//     Inside `\p -> ...`:   [0 → p, 1 → a]              → `p + a` = add(0, 1)
		//     Inside `\k -> ...`:   [0 → k, 1 → f, 2 → a]       → `k a` = App(0, 2),  `f a` = App(1, 2)
		//     At return position:   [0 → v, 1 → f, 2 → a]       → `v + a` = add(0, 2)
		//
		//   let-rec (FUTURE — what the elaborator actually produces):
		//     Inside `\p -> ...`:   [0 → p, 1 → f, 2 → a]       → `p + a` = add(0, 2)
		//     Inside `\k -> ...`:   [0 → k, 1 → v, 2 → f, 3 → a] → `k a` = App(0, 3),  `f a` = App(2, 3)
		//     At return position:   [0 → v, 1 → f, 2 → a]       → `v + a` = add(0, 2)  (unchanged)
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const shiftBody = EB.DSL.lambda(
			"k",
			EB.DSL.add(
				EB.DSL.app(EB.DSL.bound(0), EB.DSL.bound(2)), // k a
				EB.DSL.app(EB.DSL.bound(0), EB.DSL.app(EB.DSL.bound(1), EB.DSL.bound(2))), // k (f a)
			),
			EB.DSL.type("Num"),
		);
		const stmts: EB.Statement[] = [
			EB.Constructors.Stmt.Let("a", EB.DSL.num(5), numTy),
			EB.Constructors.Stmt.Let("f", EB.DSL.lambda("p", EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1)), EB.DSL.type("Num")), undefined as any),
			EB.Constructors.Stmt.Let("v", EB.Constructors.Shift(shiftBody), numTy),
		];
		const returnTerm = EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(2));
		const block = EB.Constructors.Block(stmts, returnTerm);
		const term = EB.Constructors.Reset(block);
		const mod = lowerToMir(term);
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});

	it("throws when shift body captures k in a closure", () => {
		const innerLambda = EB.DSL.lambda("x", EB.DSL.app(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const shiftBody = EB.DSL.lambda("k", EB.DSL.app(innerLambda, EB.DSL.num(1)), EB.DSL.type("Num"));
		const term = EB.Constructors.Reset(EB.Constructors.Shift(shiftBody));
		expect(() => lowerToMir(term)).toThrow(/captures continuation k/);
	});

	it("lowers simple match on literal (wildcard)", () => {
		const term = EB.Constructors.Match(EB.DSL.num(1), [{ pattern: { type: "Wildcard" }, term: EB.DSL.num(2), binders: [] }]);
		const mod = lowerToMir(term);
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});
});
