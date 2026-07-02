import { describe, it, expect, beforeEach } from "vitest";
import * as E from "fp-ts/Either";
import { pipe } from "fp-ts/function";

import * as EB from "@yap/elaboration";
import * as GRAM from "../index";
import { interpret } from "../../lowering/interpret";
import { resetId } from "../graph";
import * as MIR from "../../lowering/mir";
import { display } from "../../lowering/pretty";
import { ARITIES } from "../../lowering/shared/primops";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
import { elaborateFrom } from "../../elaboration/inference/__tests__/util";

const bridge = (term: EB.Term): MIR.Module =>
	pipe(
		GRAM.Pipeline.compile(term, { arities: ARITIES }),
		E.map(GRAM.Bridge.emit),
		E.getOrElseW(() => {
			throw new Error("pipeline failed");
		}),
	);

const via = (term: EB.Term) => interpret(bridge(term));

describe("GRAM Bridge: Phase 1 — leaves and structural ops", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
		MIR.resetId();
	});

	it("Lit(42) emits correctly", () => {
		const result = via(EB.DSL.num(42));
		expect(result).toBe(42);
	});

	it("Lit(true)", () => {
		expect(via(EB.DSL.bool(true))).toBe(true);
	});

	it("Lit(string)", () => {
		expect(via(EB.DSL.str("hello"))).toBe("hello");
	});

	it("struct { x: 1, y: 2 }", () => {
		const term = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(1) },
			{ label: "y", value: EB.DSL.num(2) },
		]);
		const result = via(term);
		expect(result).toEqual({ x: 1, y: 2 });
	});

	it("proj('x', struct { x: 42 })", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		const result = via(term);
		expect(result).toBe(42);
	});

	it("inj('z', 99, struct { x: 1 })", () => {
		const base = EB.DSL.struct([{ label: "x", value: EB.DSL.num(1) }]);
		const term = EB.DSL.inj("z", EB.DSL.num(99), base);
		const result = via(term) as Record<string, unknown>;
		expect(result.z).toBe(99);
		expect(result.x).toBe(1);
	});

	const label = (name: string): EB.Term => EB.Constructors.Var({ type: "Label", name });

	it("backward label ref { b: 10, a: :b + 1 }", () => {
		const term = EB.DSL.struct([
			{ label: "b", value: EB.DSL.num(10) },
			{ label: "a", value: EB.DSL.add(label("b"), EB.DSL.num(1)) },
		]);
		expect(via(term)).toEqual({ b: 10, a: 11 });
	});

	it("forward label ref { a: :b + 1, b: 10 }", () => {
		const term = EB.DSL.struct([
			{ label: "a", value: EB.DSL.add(label("b"), EB.DSL.num(1)) },
			{ label: "b", value: EB.DSL.num(10) },
		]);
		expect(via(term)).toEqual({ a: 11, b: 10 });
	});

	it("label captured into a closure reads off the record: ({ x: 10, f: \\n -> :x }).f 0 == 10", () => {
		const rec = EB.DSL.struct([
			{ label: "x", value: EB.DSL.num(10) },
			{ label: "f", value: EB.DSL.lambda("n", label("x"), EB.DSL.type("Num")) },
		]);
		expect(via(EB.DSL.app(EB.DSL.proj("f", rec), EB.DSL.num(0)))).toBe(10);
	});

	it("self-recursive field ties via the record without looping", () => {
		const mod = bridge(EB.DSL.struct([{ label: "f", value: EB.DSL.lambda("n", label("f"), EB.DSL.type("Num")) }]));
		const main = mod.functions.find(f => f.name === "main");
		const backpatched = (main?.blocks ?? []).flatMap(b => b.instrs).some(i => i.type === "Update" && i.mode === "fbip");
		const closure = mod.functions.find(f => f.name.startsWith("closure_"));
		const readsRecord = (closure?.blocks ?? []).flatMap(b => b.instrs).some(i => i.type === "Read");
		expect(backpatched).toBe(true);
		expect(readsRecord).toBe(true);
	});

	it("let x = 42 in x", () => {
		const term = EB.mk({
			type: "Abs",
			binding: { type: "Let", variable: "x", value: EB.DSL.num(42), annotation: EB.DSL.type("Num") },
			body: EB.DSL.bound(0),
		});
		const result = via(term);
		expect(result).toBe(42);
	});

	it("snapshot: struct { x: 1 }", () => {
		const term = EB.DSL.struct([{ label: "x", value: EB.DSL.num(1) }]);
		expect(display.module(bridge(term))).toMatchSnapshot();
	});

	it("snapshot: proj('x', struct { x: 42 })", () => {
		const term = EB.DSL.proj("x", EB.DSL.struct([{ label: "x", value: EB.DSL.num(42) }]));
		expect(display.module(bridge(term))).toMatchSnapshot();
	});
});

describe("GRAM Bridge: Phase 2 — closures and primops", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
		MIR.resetId();
	});

	it("add(1, 2) — saturated primop", () => {
		const term = EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2));
		const result = via(term);
		expect(result).toBe(3);
	});

	it("mul(3, 4) — saturated primop", () => {
		const term = EB.DSL.mul(EB.DSL.num(3), EB.DSL.num(4));
		const result = via(term);
		expect(result).toBe(12);
	});

	it("(λx. x) 42 — identity closure", () => {
		const id = EB.DSL.lambda("x", EB.DSL.bound(0), EB.DSL.type("Num"));
		const term = EB.DSL.app(id, EB.DSL.num(42));
		expect(display.module(bridge(term))).toMatchSnapshot();
		const result = via(term);
		expect(result).toBe(42);
	});

	it("(λx.λy. x+y) 3 4 — curried closure with captures", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(3)), EB.DSL.num(4));
		const result = via(term);
		expect(result).toBe(7);
	});

	it("snapshot: add(1, 2)", () => {
		const term = EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2));
		expect(display.module(bridge(term))).toMatchSnapshot();
	});
});

describe("GRAM Bridge: Phase 3 — pattern matching", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
		MIR.resetId();
	});

	it("match wildcard — always takes first alt", () => {
		const term = EB.DSL.match(EB.DSL.num(42), [{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(1) }]);
		const result = via(term);
		expect(result).toBe(1);
	});

	it("match literal 0 — takes matching branch", () => {
		const lam = EB.DSL.lambda(
			"x",
			EB.DSL.match(EB.DSL.bound(0), [
				{ pattern: EB.Constructors.Patterns.Lit({ type: "Num", value: 0 }), term: EB.DSL.num(1) },
				{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(2) },
			]),
			EB.DSL.type("Num"),
		);
		expect(via(EB.DSL.app(lam, EB.DSL.num(0)))).toBe(1);
	});

	it("match literal default — takes wildcard branch", () => {
		const lam = EB.DSL.lambda(
			"x",
			EB.DSL.match(EB.DSL.bound(0), [
				{ pattern: EB.Constructors.Patterns.Lit({ type: "Num", value: 0 }), term: EB.DSL.num(1) },
				{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(2) },
			]),
			EB.DSL.type("Num"),
		);
		expect(via(EB.DSL.app(lam, EB.DSL.num(99)))).toBe(2);
	});

	it("match variant Some/None — dispatches on tag", () => {
		const scrutinee = EB.DSL.struct([
			{ label: "__tag", value: EB.DSL.type("Some") },
			{ label: "payload", value: EB.DSL.num(42) },
		]);
		const term = EB.DSL.match(scrutinee, [
			{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
			{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
		]);
		expect(via(term)).toBe(42);
	});

	it("match #some 42 — elaborated variant construction runs end-to-end", () => {
		const { structure } = elaborateFrom("match #some 42 | #some x -> x | #none _ -> 0");

		expect(via(structure.term)).toBe(42);
	});

	it("match struct field binders — destructures projected fields", () => {
		const row = R.Constructors.Extension(
			"x",
			EB.Constructors.Patterns.Binder("a"),
			R.Constructors.Extension("y", EB.Constructors.Patterns.Binder("b"), R.Constructors.Empty<EB.Pattern, string>()),
		);
		const term = EB.DSL.match(
			EB.DSL.struct([
				{ label: "x", value: EB.DSL.num(3) },
				{ label: "y", value: EB.DSL.num(4) },
			]),
			[{ pattern: EB.Constructors.Patterns.Struct(row), term: EB.DSL.add(EB.DSL.bound(0), EB.DSL.bound(1)) }],
		);

		expect(via(term)).toBe(7);
	});

	it("match struct literal field — dispatches on projected field", () => {
		const exact = R.Constructors.Extension("x", EB.Constructors.Patterns.Lit(Lit.Num(0)), R.Constructors.Empty<EB.Pattern, string>());
		const bind = R.Constructors.Extension("x", EB.Constructors.Patterns.Binder("n"), R.Constructors.Empty<EB.Pattern, string>());
		const term = EB.Constructors.Match(EB.DSL.struct([{ label: "x", value: EB.DSL.num(5) }]), [
			EB.Constructors.Alternative(EB.Constructors.Patterns.Struct(exact), EB.DSL.num(1), []),
			EB.Constructors.Alternative(EB.Constructors.Patterns.Struct(bind), EB.DSL.bound(0), [["_", EB.NF.Constructors.Lit(Lit.Atom("Num"))]]),
		]);

		expect(via(term)).toBe(5);
	});

	it("match nested struct field — chains projections", () => {
		const nested = R.Constructors.Extension("y", EB.Constructors.Patterns.Binder("a"), R.Constructors.Empty<EB.Pattern, string>());
		const row = R.Constructors.Extension("x", EB.Constructors.Patterns.Struct(nested), R.Constructors.Empty<EB.Pattern, string>());
		const term = EB.DSL.match(EB.DSL.struct([{ label: "x", value: EB.DSL.struct([{ label: "y", value: EB.DSL.num(8) }]) }]), [
			{ pattern: EB.Constructors.Patterns.Struct(row), term: EB.DSL.bound(0) },
		]);

		expect(via(term)).toBe(8);
	});

	it("snapshot: match 0 / _", () => {
		const lam = EB.DSL.lambda(
			"x",
			EB.DSL.match(EB.DSL.bound(0), [
				{ pattern: EB.Constructors.Patterns.Lit({ type: "Num", value: 0 }), term: EB.DSL.num(1) },
				{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(2) },
			]),
			EB.DSL.type("Num"),
		);
		expect(display.module(bridge(EB.DSL.app(lam, EB.DSL.num(5))))).toMatchSnapshot();
	});
});

describe("GRAM Bridge: PAP — partial application objects", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
		MIR.resetId();
	});

	it("($add 1) 2 — apply PAP then call", () => {
		const pap = EB.DSL.app(EB.DSL.foreign("$add"), EB.DSL.num(1));
		const term = EB.DSL.app(pap, EB.DSL.num(2));
		const result = via(term);
		expect(result).toBe(3);
	});

	it("snapshot: $add 1 — unsaturated PAP", () => {
		const term = EB.DSL.app(EB.DSL.foreign("$add"), EB.DSL.num(1));
		expect(display.module(bridge(term))).toMatchSnapshot();
	});

	it("(λx. $add x) 1 2 — PAP in closure body", () => {
		const lam = EB.DSL.lambda("x", EB.DSL.app(EB.DSL.foreign("$add"), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(lam, EB.DSL.num(5)), EB.DSL.num(3));
		const result = via(term);
		expect(result).toBe(8);
	});
});

describe("GRAM Bridge: Phase 4 — shift/reset", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
		MIR.resetId();
	});

	it("reset(shift k -> k 42) — single resume", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		const term = EB.Constructors.Reset(EB.Constructors.Shift(body));
		const mod = bridge(term);
		expect(display.module(mod)).toMatchSnapshot();
		const result = interpret(mod);
		expect(result).toBe(42);
	});

	it("reset(shift k -> 'hello') — no resume", () => {
		const body = EB.DSL.lambda("k", EB.DSL.str("hello"), EB.DSL.type("String"));
		const term = EB.Constructors.Reset(EB.Constructors.Shift(body));
		const mod = bridge(term);
		expect(display.module(mod)).toMatchSnapshot();
		const result = interpret(mod);
		expect(result).toBe("hello");
	});

	it("reset(1 + shift k -> k 10) — rest-of-reset", () => {
		const shift = EB.Constructors.Shift(EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(10)), EB.DSL.type("Num")));
		const term = EB.Constructors.Reset(EB.DSL.add(EB.DSL.num(1), shift));
		const mod = bridge(term);
		expect(display.module(mod)).toMatchSnapshot();
		const result = interpret(mod);
		expect(result).toBe(11);
	});

	it("reset(shift k -> k 1 + k 2) — multishot", () => {
		const body = EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))), EB.DSL.type("Num"));
		const term = EB.Constructors.Reset(EB.Constructors.Shift(body));
		const mod = bridge(term);
		expect(display.module(mod)).toMatchSnapshot();
		const result = interpret(mod);
		expect(result).toBe(3);
	});
});
