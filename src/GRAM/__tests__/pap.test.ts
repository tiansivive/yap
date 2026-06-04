import { describe, it, expect, beforeEach } from "vitest";
import * as EB from "@yap/elaboration";

import { translate } from "../translate";
import { display } from "../display";
import { resetId, Nodes, Edges, Query } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { pap, descriptor as papDescriptor } from "../passes/pap";
import { saturate } from "../passes/saturate";
import { ARITIES } from "../../lowering/shared/primops";

describe("pap pass", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
	});

	describe("descriptor", () => {
		it("requires EXTERNAL tag and ARG label", () => {
			expect(papDescriptor.requires.tags.has(Tags.EXTERNAL)).toBe(true);
			expect(papDescriptor.requires.labels.has(Labels.ARG)).toBe(true);
		});

		it("adds PAP tag, MATERIALIZES and CAPTURED labels", () => {
			expect(papDescriptor.delta.tags.added.has(Tags.PAP)).toBe(true);
			expect(papDescriptor.delta.labels.added.has(Labels.MATERIALIZES)).toBe(true);
			expect(papDescriptor.delta.labels.added.has(Labels.CAPTURED)).toBe(true);
		});
	});

	describe("transformation", () => {
		it("creates PAP node for unsaturated external (add with 1 arg)", () => {
			const term = EB.DSL.app(EB.DSL.foreign("$add"), EB.DSL.num(1));
			const g0 = translate(term, { arities: ARITIES });
			const g1 = saturate(g0);
			const g2 = pap(g1);

			const paps = Query.byTag(Tags.PAP)(g2);
			expect(paps.size).toBe(1);

			const papId = [...paps][0];
			const papNode = Nodes.get(papId)(g2);
			expect(papNode?.payload.remaining).toBe(1);
		});

		it("preserves original EXTERNAL node", () => {
			const term = EB.DSL.app(EB.DSL.foreign("$add"), EB.DSL.num(1));
			const g0 = translate(term, { arities: ARITIES });
			const g1 = saturate(g0);
			const g2 = pap(g1);

			const exts = Query.byTag(Tags.EXTERNAL)(g2);
			expect(exts.size).toBe(1);
		});

		it("adds MATERIALIZES edge from PAP to EXTERNAL", () => {
			const term = EB.DSL.app(EB.DSL.foreign("$add"), EB.DSL.num(1));
			const g0 = translate(term, { arities: ARITIES });
			const g1 = saturate(g0);
			const g2 = pap(g1);

			const papId = [...Query.byTag(Tags.PAP)(g2)][0];
			const materializesEdge = Edges.one(papId, Labels.MATERIALIZES)(g2);
			expect(materializesEdge).toBeDefined();

			const targetNode = Nodes.get(materializesEdge!.target)(g2);
			expect(targetNode?.tag).toBe(Tags.EXTERNAL);
		});

		it("adds CAPTURED edges from PAP to args", () => {
			const term = EB.DSL.app(EB.DSL.foreign("$add"), EB.DSL.num(1));
			const g0 = translate(term, { arities: ARITIES });
			const g1 = saturate(g0);
			const g2 = pap(g1);

			const papId = [...Query.byTag(Tags.PAP)(g2)][0];
			const capturedEdges = Edges.byLabel(papId, Labels.CAPTURED)(g2);
			expect(capturedEdges.length).toBe(1);
			expect(capturedEdges[0].payload.index).toBe(0);
		});

		it("does not create PAP for saturated external", () => {
			const term = EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2));
			const g0 = translate(term, { arities: ARITIES });
			const g1 = saturate(g0);
			const g2 = pap(g1);

			const paps = Query.byTag(Tags.PAP)(g2);
			expect(paps.size).toBe(0);
		});

		it("calculates correct remaining arity (arity 2, 1 arg = 1 remaining)", () => {
			const term = EB.DSL.app(EB.DSL.foreign("$add"), EB.DSL.num(1));
			const g0 = translate(term, { arities: ARITIES });
			const g1 = saturate(g0);
			const g2 = pap(g1);

			const papId = [...Query.byTag(Tags.PAP)(g2)][0];
			const papNode = Nodes.get(papId)(g2);
			expect(papNode?.payload.remaining).toBe(1);
		});

		it("snapshot — unsaturated $add with 1 arg", () => {
			const term = EB.DSL.app(EB.DSL.foreign("$add"), EB.DSL.num(1));
			const g0 = translate(term, { arities: ARITIES });
			const g1 = saturate(g0);
			const g2 = pap(g1);
			expect(display(g2)).toMatchSnapshot();
		});

		it("snapshot — unsaturated inside lambda body", () => {
			const inner = EB.DSL.app(EB.DSL.foreign("$add"), EB.DSL.bound(0));
			const term = EB.DSL.lambda("x", inner, EB.DSL.type("Num"));
			const g0 = translate(term, { arities: ARITIES });
			const g1 = saturate(g0);
			const g2 = pap(g1);
			expect(display(g2)).toMatchSnapshot();
		});
	});
});
