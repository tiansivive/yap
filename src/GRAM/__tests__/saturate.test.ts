import { describe, it, expect, beforeEach } from "vitest";
import * as EB from "@yap/elaboration";

import { translate } from "../translate";
import { display } from "../display";
import { resetId, Nodes, Query, entry } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { saturate } from "../passes/saturate";
import { ARITIES } from "../../lowering/shared/primops";

describe("saturate", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
	});

	it("add(1, 2) → primop", () => {
		const term = EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2));
		const g = saturate(translate(term, { arities: ARITIES }));
		expect(display(g)).toMatchSnapshot();

		expect(Query.byTag(Tags.PRIMOP)(g).size).toBe(1);
		expect(Query.byTag(Tags.APP)(g).size).toBe(0);

		const primop = [...Query.byTag(Tags.PRIMOP)(g)][0];
		expect(Nodes.get(primop)(g)?.payload.op).toBe("$add");
	});

	it("not(true) → primop (arity 1)", () => {
		const term = EB.DSL.not(EB.DSL.bool(true));
		const g = saturate(translate(term, { arities: ARITIES }));
		expect(display(g)).toMatchSnapshot();

		expect(Query.byTag(Tags.PRIMOP)(g).size).toBe(1);
		expect(Query.byTag(Tags.APP)(g).size).toBe(0);
	});

	it("add(add(1, 2), 3) → two primops", () => {
		const term = EB.DSL.add(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)), EB.DSL.num(3));
		const g = saturate(translate(term, { arities: ARITIES }));
		expect(display(g)).toMatchSnapshot();

		expect(Query.byTag(Tags.PRIMOP)(g).size).toBe(2);
		expect(Query.byTag(Tags.APP)(g).size).toBe(0);
	});

	it("preserves non-foreign apps", () => {
		const term = EB.DSL.app(EB.DSL.free("f"), EB.DSL.num(1));
		const g = saturate(translate(term, { arities: ARITIES }));

		expect(Query.byTag(Tags.APP)(g).size).toBe(1);
		expect(Query.byTag(Tags.PRIMOP)(g).size).toBe(0);
		expect(Query.byTag(Tags.EXTERNAL)(g).size).toBe(0);
	});

	it("preserves entry", () => {
		const term = EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2));
		const g = saturate(translate(term, { arities: ARITIES }));

		expect(entry(g)).toBeDefined();
	});

	it("(λx.λy.x+y) 3 4 — saturates inner add, preserves lambda apps", () => {
		const inner = EB.DSL.lambda("y", EB.DSL.add(EB.DSL.bound(1), EB.DSL.bound(0)), EB.DSL.type("Num"));
		const outer = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
		const term = EB.DSL.app(EB.DSL.app(outer, EB.DSL.num(3)), EB.DSL.num(4));
		const g = saturate(translate(term, { arities: ARITIES }));
		expect(display(g)).toMatchSnapshot();

		expect(Query.byTag(Tags.PRIMOP)(g).size).toBe(1);
		expect(Query.byTag(Tags.APP)(g).size).toBe(2);
	});
});
