import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { mkCtx } from "../../inference/__tests__/util";

const Num = NF.Constructors.Lit({ type: "Atom", value: "Num" });
const Type = NF.Type;

const simplePi = (variable: string, annotation: NF.Value, body: NF.Value) =>
	NF.Constructors.Pi(variable, "Explicit", annotation, NF.Constructors.Closure(mkCtx(), NF.quote(mkCtx(), 0, body)));

describe("NF.arity", () => {
	it("returns 0 for a ground type", () => {
		expect(NF.arity(mkCtx(), Num)).toBe(0);
	});

	it("returns 0 for Schema type", () => {
		const schema = NF.Constructors.Schema({ type: "empty" });
		expect(NF.arity(mkCtx(), schema)).toBe(0);
	});

	it("counts 1 for Num -> Num", () => {
		const ty = NF.Constructors.Pi("x", "Explicit", Num, NF.Constructors.Closure(mkCtx(), EB.Constructors.Lit({ type: "Atom", value: "Num" })));
		expect(NF.arity(mkCtx(), ty)).toBe(1);
	});

	it("counts 2 for Num -> Num -> Num", () => {
		const inner = NF.Constructors.Pi("y", "Explicit", Num, NF.Constructors.Closure(mkCtx(), EB.Constructors.Lit({ type: "Atom", value: "Num" })));
		const innerQuoted = NF.quote(mkCtx(), 0, inner);
		const ty = NF.Constructors.Pi("x", "Explicit", Num, NF.Constructors.Closure(mkCtx(), innerQuoted));
		expect(NF.arity(mkCtx(), ty)).toBe(2);
	});

	it("counts implicit binders toward arity", () => {
		const inner = NF.Constructors.Pi(
			"x",
			"Explicit",
			NF.Constructors.Rigid(0),
			NF.Constructors.Closure(mkCtx(), EB.Constructors.Var({ type: "Bound", index: 0 })),
		);
		const innerQuoted = NF.quote(mkCtx(), 1, inner);
		const ty = NF.Constructors.Pi("A", "Implicit", Type, NF.Constructors.Closure(mkCtx(), innerQuoted));
		expect(NF.arity(mkCtx(), ty)).toBe(2);
	});

	it("returns 0 for Variant type", () => {
		const variant = NF.Constructors.Variant({ type: "extension", label: "Some", value: Num, row: { type: "empty" } });
		expect(NF.arity(mkCtx(), variant)).toBe(0);
	});
});

describe("NF.inert", () => {
	it("Lit is inert", () => {
		expect(NF.inert(Num)).toBe(true);
	});

	it("Schema is inert", () => {
		expect(NF.inert(NF.Constructors.Schema({ type: "empty" }))).toBe(true);
	});

	it("Variant is inert", () => {
		expect(NF.inert(NF.Constructors.Variant({ type: "empty" }))).toBe(true);
	});

	it("Pi is NOT inert", () => {
		const ty = NF.Constructors.Pi("x", "Explicit", Num, NF.Constructors.Closure(mkCtx(), EB.Constructors.Lit({ type: "Atom", value: "Num" })));
		expect(NF.inert(ty)).toBe(false);
	});

	it("unsolved Meta is NOT inert", () => {
		const meta = NF.Constructors.Flex({ type: "Meta", val: 99, lvl: 0 });
		expect(NF.inert(meta)).toBe(false);
	});

	it("rigid variable without apps is inert", () => {
		const rigid = NF.Constructors.Rigid(0);
		expect(NF.inert(rigid)).toBe(true);
	});

	it("rigid applied to args (stuck app) is NOT inert", () => {
		const stuck = NF.Constructors.Neutral("Symbolic", NF.Constructors.App(NF.Constructors.Var({ type: "Bound", lvl: 0 }), Num, "Explicit"));
		expect(NF.inert(stuck)).toBe(false);
	});

	it("StuckMatch is NOT inert", () => {
		const stuckMatch = NF.Constructors.StuckMatch(NF.Constructors.Closure(mkCtx(), EB.Constructors.Lit({ type: "Atom", value: "Num" })), Num);
		expect(NF.inert(stuckMatch)).toBe(false);
	});

	it("Foreign var is inert", () => {
		const foreign = NF.Constructors.Neutral("Sealed", NF.Constructors.Var({ type: "Foreign", name: "Indexed" }));
		expect(NF.inert(foreign)).toBe(true);
	});
});
