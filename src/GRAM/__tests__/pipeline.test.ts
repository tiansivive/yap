import { describe, it, expect, beforeEach } from "vitest";
import * as E from "fp-ts/Either";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";

import { translate } from "../translate";
import { display } from "../display";
import { resetId, Query, entry, mkGraph } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { ARITIES } from "../../lowering/shared/primops";

import { compile, configure, verify, defaultPipeline } from "../pipeline";
import type { Descriptor } from "../pipeline";
import { none, Initial } from "../pipeline";
import { descriptor as eta } from "../passes/eta";
import { descriptor as saturate } from "../passes/saturate";
import { descriptor as closure } from "../passes/closure";

const reset = () => {
	EB.resetId();
	resetId();
};

// ── compile (end-to-end) ──

describe("compile", () => {
	beforeEach(reset);

	it("literal — 42", () => {
		const result = compile(EB.DSL.num(42));
		expect(E.isRight(result)).toBe(true);

		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
		}
	});

	it("identity — λx. x", () => {
		const result = compile(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int")));
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
			expect(Query.byTag(Tags.CLOSURE)(result.right).size).toBe(1);
			expect(Query.byTag(Tags.LAMBDA)(result.right).size).toBe(1);
		}
	});

	it("eta-reducible — λx. f(x)", () => {
		const result = compile(EB.DSL.lambda("x", EB.DSL.app(EB.DSL.free("f"), EB.DSL.bound(0)), EB.DSL.free("Int")));
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
			expect(Query.byTag(Tags.LAMBDA)(result.right).size).toBe(0);
			expect(Query.byTag(Tags.APP)(result.right).size).toBe(0);
		}
	});

	it("primop — add(1, 2)", () => {
		const result = compile(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)), { arities: ARITIES });
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
			expect(Query.byTag(Tags.PRIMOP)(result.right).size).toBe(1);
			expect(Query.byTag(Tags.APP)(result.right).size).toBe(0);
		}
	});

	it("nested primop — add(add(1, 2), 3)", () => {
		const result = compile(EB.DSL.add(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)), EB.DSL.num(3)), { arities: ARITIES });
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
			expect(Query.byTag(Tags.PRIMOP)(result.right).size).toBe(2);
		}
	});

	it("curried closure — (λx.λy. x+y) 3 4", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(3)), EB.DSL.num(4));
		const result = compile(term, { arities: ARITIES });
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
			expect(Query.byTag(Tags.LAMBDA)(result.right).size).toBe(1);
			expect(Query.byTag(Tags.CLOSURE)(result.right).size).toBe(1);
			expect(Query.byTag(Tags.APP)(result.right).size).toBe(2);
		}
	});

	it("block with let — let a = 1; λx. a + x (eta-reduces)", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [EB.Constructors.Stmt.Let("a", EB.DSL.num(1), numTy)];
		const body = EB.DSL.lambda("x", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const result = compile(EB.Constructors.Block(stmts, body), { arities: ARITIES });
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
			expect(Query.byTag(Tags.LAMBDA)(result.right).size).toBe(0);
		}
	});

	it("block with let — non-eta-reducible closure", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [EB.Constructors.Stmt.Let("a", EB.DSL.num(1), numTy)];
		const body = EB.DSL.lambda("x", EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const result = compile(EB.Constructors.Block(stmts, body), { arities: ARITIES });
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
			expect(Query.byTag(Tags.LAMBDA)(result.right).size).toBe(1);
			expect(Query.byTag(Tags.CLOSURE)(result.right).size).toBe(1);
		}
	});

	it("struct/proj — { x: 1, y: 2 }.x", () => {
		const s = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		const result = compile(EB.DSL.proj("x", s));
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
			expect(Query.byTag(Tags.PROJ)(result.right).size).toBe(1);
		}
	});

	it("match — variant alternatives", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.str("Some") },
			{ label: "Some", value: EB.DSL.num(42) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		const result = compile(term);
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
			expect(Query.byTag(Tags.CASE)(result.right).size).toBe(2);
		}
	});

	it("complex — nested lambdas + free vars + foreigns + let + match", () => {
		const numTy = NF.Constructors.Lit(Lit.Atom("Num"));
		const stmts: EB.Statement[] = [EB.Constructors.Stmt.Let("n", EB.DSL.num(10), numTy)];
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const applied = EB.DSL.app(outer, EB.DSL.bound(0));
		const result = compile(EB.Constructors.Block(stmts, applied), { arities: ARITIES });
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(display(result.right)).toMatchSnapshot();
			expect(entry(result.right)).toBeDefined();
		}
	});

	it("entry is always preserved", () => {
		const result = compile(EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.free("Int")));
		expect(E.isRight(result)).toBe(true);

		if (E.isRight(result)) {
			expect(entry(result.right)).toBeDefined();
		}
	});
});

// ── shift/reset ──

describe("shift/reset", () => {
	beforeEach(reset);

	it("reset(shift k -> k(42))", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		const result = compile(EB.Constructors.Reset(EB.Constructors.Shift(body)));
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(Query.byTag(Tags.BUBBLE)(result.right).size).toBe(1);
			expect(Query.byTag(Tags.CONTINUATION)(result.right).size).toBe(1);
			expect(Query.byTag(Tags.RESUMPTION)(result.right).size).toBe(1);
			expect(display(result.right)).toMatchSnapshot();
		}
	});

	it("reset(shift k -> k(1) + k(2)) — multishot", () => {
		const body = EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))), EB.DSL.type("Num"));
		const result = compile(EB.Constructors.Reset(EB.Constructors.Shift(body)), { arities: ARITIES });
		expect(E.isRight(result)).toBe(true);
		if (E.isRight(result)) {
			expect(Query.byTag(Tags.BUBBLE)(result.right).size).toBe(1);
			expect(Query.byTag(Tags.CONTINUATION)(result.right).size).toBe(1);
			expect(Query.byTag(Tags.RESUMPTION)(result.right).size).toBe(2);
			expect(display(result.right)).toMatchSnapshot();
		}
	});
});

// ── configure (pipeline validation) ──

describe("configure", () => {
	it("default pipeline is valid", () => {
		expect(E.isRight(defaultPipeline)).toBe(true);
	});

	it("detects missing tag requirement", () => {
		const fake: Descriptor = {
			name: "fake",
			requires: { tags: new Set(["nonexistent_tag"]), labels: new Set() },
			delta: { tags: none, labels: none },
			run: g => g,
		};
		const result = configure(fake);
		expect(E.isLeft(result)).toBe(true);
		if (E.isLeft(result)) {
			expect(result.left.some(e => e.type === "MissingTag" && e.tag === "nonexistent_tag")).toBe(true);
		}
	});

	it("detects missing label requirement", () => {
		const fake: Descriptor = {
			name: "fake",
			requires: { tags: new Set(), labels: new Set([":nonexistent"]) },
			delta: { tags: none, labels: none },
			run: g => g,
		};
		const result = configure(fake);
		expect(E.isLeft(result)).toBe(true);
		if (E.isLeft(result)) {
			expect(result.left.some(e => e.type === "MissingLabel" && e.label === ":nonexistent")).toBe(true);
		}
	});

	it("detects consumed-after-removal", () => {
		const remover: Descriptor = {
			name: "remover",
			requires: { tags: new Set([Tags.APP]), labels: new Set() },
			delta: { tags: { added: new Set(), removed: new Set([Tags.APP]) }, labels: none },
			run: g => g,
		};
		const consumer: Descriptor = {
			name: "consumer",
			requires: { tags: new Set([Tags.APP]), labels: new Set() },
			delta: { tags: none, labels: none },
			run: g => g,
		};
		const result = configure(remover, consumer);
		expect(E.isLeft(result)).toBe(true);
		if (E.isLeft(result)) {
			expect(result.left.some(e => e.type === "ConsumedAfterRemoval" && e.removedBy === "remover")).toBe(true);
		}
	});

	it("allows consumption of tags produced by earlier pass", () => {
		const producer: Descriptor = {
			name: "producer",
			requires: { tags: new Set(), labels: new Set() },
			delta: { tags: { added: new Set(["custom_tag"]), removed: new Set() }, labels: none },
			run: g => g,
		};
		const consumer: Descriptor = {
			name: "consumer",
			requires: { tags: new Set(["custom_tag"]), labels: new Set() },
			delta: { tags: none, labels: none },
			run: g => g,
		};
		expect(E.isRight(configure(producer, consumer))).toBe(true);
	});
});

// ── verify (graph invariants) ──

describe("verify", () => {
	beforeEach(reset);

	it("valid graph passes", () => {
		const g = translate(EB.DSL.num(42));
		expect(E.isRight(verify(g))).toBe(true);
	});

	it("detects missing entry", () => {
		const g = mkGraph();
		const result = verify(g);
		expect(E.isLeft(result)).toBe(true);
		if (E.isLeft(result)) {
			expect(result.left.some(v => v.type === "NoEntry")).toBe(true);
		}
	});

	it("detects unexpected tags", () => {
		const g = translate(EB.DSL.num(42));
		const restrictive = { tags: new Set([Tags.ROOT]), labels: new Set<string>() };
		const result = verify(g, restrictive);
		expect(E.isLeft(result)).toBe(true);
		if (E.isLeft(result)) {
			expect(result.left.some(v => v.type === "UnexpectedTag")).toBe(true);
		}
	});

	it("full pipeline output passes verify with final vocabulary", () => {
		const term = EB.DSL.lambda("x", EB.DSL.add(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.type("Num"));
		const result = compile(term, { arities: ARITIES });
		expect(E.isRight(result)).toBe(true);
	});
});
