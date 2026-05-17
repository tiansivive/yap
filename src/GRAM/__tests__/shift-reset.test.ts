import { describe, it, expect, beforeEach } from "vitest";
import * as EB from "@yap/elaboration";

import { translate } from "../translate";
import { display } from "../display";
import { resetId, Query, Nodes, Edges } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { shiftReset } from "../passes/shift-reset";

const reset = () => {
	EB.resetId();
	resetId();
};

describe("shift-reset enrichment pass", () => {
	beforeEach(reset);

	it("reset(shift k -> k(42)) — single resumption", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		const g = shiftReset(translate(EB.Constructors.Reset(EB.Constructors.Shift(body))));

		expect(Query.byTag(Tags.BUBBLE)(g).size).toBe(1);
		expect(Query.byTag(Tags.CONTINUATION)(g).size).toBe(1);
		expect(Query.byTag(Tags.RESUMPTION)(g).size).toBe(1);

		const contId = [...Query.byTag(Tags.CONTINUATION)(g)][0];
		expect(Edges.one(contId, Labels.DELIMITER)(g)).toBeDefined();
		expect(Edges.one(contId, Labels.CAPTURED_AT)(g)).toBeDefined();
		expect(Edges.one(contId, Labels.HANDLER)(g)).toBeDefined();
		expect(Edges.one(contId, Labels.PARAM)(g)).toBeDefined();

		const resId = [...Query.byTag(Tags.RESUMPTION)(g)][0];
		expect(Edges.one(resId, Labels.INVOKES)(g)?.target).toBe(contId);
		expect(Edges.one(resId, Labels.ARG)(g)).toBeDefined();

		expect(display(g)).toMatchSnapshot();
	});

	it("reset(shift k -> k(1) + k(2)) — multishot", () => {
		const body = EB.DSL.lambda("k", EB.DSL.add(EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(1)), EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(2))), EB.DSL.type("Num"));
		const g = shiftReset(translate(EB.Constructors.Reset(EB.Constructors.Shift(body))));

		expect(Query.byTag(Tags.BUBBLE)(g).size).toBe(1);
		expect(Query.byTag(Tags.CONTINUATION)(g).size).toBe(1);
		expect(Query.byTag(Tags.RESUMPTION)(g).size).toBe(2);

		const contId = [...Query.byTag(Tags.CONTINUATION)(g)][0];
		const resumptions = [...Query.byTag(Tags.RESUMPTION)(g)];
		resumptions.forEach(r => expect(Edges.one(r, Labels.INVOKES)(g)?.target).toBe(contId));

		expect(display(g)).toMatchSnapshot();
	});

	it("reset(shift k -> 'hello') — discarded continuation", () => {
		const body = EB.DSL.lambda("k", EB.DSL.str("hello"), EB.DSL.type("Str"));
		const g = shiftReset(translate(EB.Constructors.Reset(EB.Constructors.Shift(body))));

		expect(Query.byTag(Tags.BUBBLE)(g).size).toBe(1);
		expect(Query.byTag(Tags.CONTINUATION)(g).size).toBe(1);
		expect(Query.byTag(Tags.RESUMPTION)(g).size).toBe(0);

		expect(display(g)).toMatchSnapshot();
	});

	it("reset(1 + shift(k -> k(42))) — shift embedded in expression", () => {
		const shiftExpr = EB.Constructors.Shift(EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num")));
		const term = EB.Constructors.Reset(EB.DSL.add(EB.DSL.num(1), shiftExpr));
		const g = shiftReset(translate(term));

		expect(Query.byTag(Tags.BUBBLE)(g).size).toBe(1);
		expect(Query.byTag(Tags.CONTINUATION)(g).size).toBe(1);
		expect(Query.byTag(Tags.RESUMPTION)(g).size).toBe(1);

		const bubbleId = [...Query.byTag(Tags.BUBBLE)(g)][0];
		expect(Nodes.get(bubbleId)(g)?.payload.binder).toBe("$bubble_0");

		expect(display(g)).toMatchSnapshot();
	});

	it("reset(shift k -> k(k(10))) — nested resumption", () => {
		const inner = EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(10));
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), inner), EB.DSL.type("Num"));
		const g = shiftReset(translate(EB.Constructors.Reset(EB.Constructors.Shift(body))));

		expect(Query.byTag(Tags.RESUMPTION)(g).size).toBe(2);

		expect(display(g)).toMatchSnapshot();
	});

	it("reset(10) — no shift, pass is no-op", () => {
		const before = translate(EB.Constructors.Reset(EB.DSL.num(10)));
		const after = shiftReset(before);

		expect(Query.byTag(Tags.BUBBLE)(after).size).toBe(0);
		expect(Query.byTag(Tags.CONTINUATION)(after).size).toBe(0);
		expect(display(after)).toBe(display(before));
	});

	it("shift is preserved for provenance", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		const g = shiftReset(translate(EB.Constructors.Reset(EB.Constructors.Shift(body))));

		expect(Query.byTag(Tags.SHIFT)(g).size).toBe(1);
		expect(Query.byTag(Tags.RESET)(g).size).toBe(1);

		const contId = [...Query.byTag(Tags.CONTINUATION)(g)][0];
		const shiftId = Edges.one(contId, Labels.CAPTURED_AT)(g)?.target;
		expect(shiftId).toBeDefined();
		expect(Nodes.get(shiftId!)(g)?.tag).toBe(Tags.SHIFT);
	});

	it("continuation :delimiter points to reset", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		const g = shiftReset(translate(EB.Constructors.Reset(EB.Constructors.Shift(body))));

		const contId = [...Query.byTag(Tags.CONTINUATION)(g)][0];
		const resetId = Edges.one(contId, Labels.DELIMITER)(g)?.target;
		expect(resetId).toBeDefined();
		expect(Nodes.get(resetId!)(g)?.tag).toBe(Tags.RESET);
	});

	it("continuation :handler points to lambda", () => {
		const body = EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num"));
		const g = shiftReset(translate(EB.Constructors.Reset(EB.Constructors.Shift(body))));

		const contId = [...Query.byTag(Tags.CONTINUATION)(g)][0];
		const handlerId = Edges.one(contId, Labels.HANDLER)(g)?.target;
		expect(handlerId).toBeDefined();
		expect(Nodes.get(handlerId!)(g)?.tag).toBe(Tags.LAMBDA);
	});

	it("bubble binder uses let variable name when in let binding", () => {
		const shiftExpr = EB.Constructors.Shift(EB.DSL.lambda("k", EB.DSL.app(EB.DSL.bound(0), EB.DSL.num(42)), EB.DSL.type("Num")));
		const block = EB.Constructors.Block(
			[EB.Constructors.Stmt.Let("v", shiftExpr, { type: "Lit", value: { type: "Atom", value: "Num" } } as any)],
			EB.DSL.bound(0),
		);
		const g = shiftReset(translate(EB.Constructors.Reset(block)));

		const bubbleId = [...Query.byTag(Tags.BUBBLE)(g)][0];
		expect(Nodes.get(bubbleId)(g)?.payload.binder).toBe("v");
	});
});
