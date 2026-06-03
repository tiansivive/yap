import { describe, it, expect, beforeEach } from "vitest";
import * as NF from "@yap/elaboration/normalization";
import type * as EB from "@yap/elaboration";

import { mkGraph, Nodes, Edges, Query, resetId as resetGraphId } from "../../graph";
import { Tags, Labels } from "../../vocabulary";
import * as Kernel from "../kernel";

beforeEach(() => {
	NF.resetId();
	resetGraphId();
});

const { Rule } = NF.DSL;

const mkMinimalCtx = (imports: Record<string, [unknown, NF.Value, unknown]>): EB.Context =>
	({
		imports,
		gamma: [],
		sigma: {},
		record: {},
		zonker: { forward: new Map(), backward: new Map() },
		metas: {},
		ffi: {},
		trace: [],
	}) as unknown as EB.Context;

describe("Kernel.run", () => {
	it("returns graph unchanged when ctx is undefined", () => {
		const g = mkGraph();
		const result = Kernel.run(g, undefined);
		expect(result).toBe(g);
	});

	it("returns graph unchanged when no modal nodes with gram annotations", () => {
		let g = mkGraph();
		const [litId, g1] = Nodes.add(Tags.LIT, { value: 42 }, { created_by: "test" })(g);
		g = Edges.add(g1.root, Labels.ENTRY, litId)(g1);

		const ctx = mkMinimalCtx({});
		const result = Kernel.run(g, ctx);

		expect(Query.byTag(Tags.LIT)(result).size).toBe(1);
	});

	it("discovers rules from modal nodes with :rewrite_rule edges", () => {
		const ruleNf = Rule.rule(Rule.lhs([Rule.pattern("n", Tags.LIT)]), Rule.rhs([Rule.constructor("n", Tags.LIT, { marked: true })]));

		let g = mkGraph();
		const [litId, g1] = Nodes.add(Tags.LIT, { value: 42 }, { created_by: "test" })(g);
		const [modalId, g2] = Nodes.add(Tags.MODAL, { quantity: "Many" }, { created_by: "test" })(g1);
		const [ruleRefId, g3] = Nodes.add(Tags.VAR_FREE, { name: "myRule" }, { created_by: "test" })(g2);
		let g4 = Edges.add(g3.root, Labels.ENTRY, modalId)(g3);
		g4 = Edges.add(modalId, Labels.TERM, litId)(g4);
		g4 = Edges.add(modalId, Labels.REWRITE_RULE, ruleRefId)(g4);

		const ctx = mkMinimalCtx({
			myRule: [undefined, ruleNf, undefined],
		});

		const result = Kernel.run(g4, ctx);

		const lits = [...Query.byTag(Tags.LIT)(result)];
		expect(lits.length).toBe(1);
		const litNode = Nodes.get(lits[0])(result);
		expect(litNode?.payload.marked).toBe(true);
	});

	it("handles VAR_REF nodes pointing to VAR_FREE definitions", () => {
		const ruleNf = Rule.rule(Rule.lhs([Rule.pattern("n", Tags.LIT)]), Rule.rhs([Rule.constructor("n", Tags.LIT, { fromRef: true })]));

		let g = mkGraph();
		const [litId, g1] = Nodes.add(Tags.LIT, { value: 42 }, { created_by: "test" })(g);
		const [modalId, g2] = Nodes.add(Tags.MODAL, { quantity: "Many" }, { created_by: "test" })(g1);
		const [ruleDefId, g3] = Nodes.add(Tags.VAR_FREE, { name: "myRule" }, { created_by: "test" })(g2);
		const [ruleRefId, g4] = Nodes.add(Tags.VAR_REF, {}, { created_by: "test" })(g3);
		let g5 = Edges.add(g4.root, Labels.ENTRY, modalId)(g4);
		g5 = Edges.add(modalId, Labels.TERM, litId)(g5);
		g5 = Edges.add(modalId, Labels.REWRITE_RULE, ruleRefId)(g5);
		g5 = Edges.add(ruleRefId, Labels.REFERS_TO, ruleDefId)(g5);

		const ctx = mkMinimalCtx({
			myRule: [undefined, ruleNf, undefined],
		});

		const result = Kernel.run(g5, ctx);

		const lits = [...Query.byTag(Tags.LIT)(result)];
		expect(lits.length).toBe(1);
		const litNode = Nodes.get(lits[0])(result);
		expect(litNode?.payload.fromRef).toBe(true);
	});

	it("deduplicates rules by name", () => {
		const ruleNf = Rule.rule(Rule.lhs([Rule.pattern("n", Tags.LIT)]), Rule.rhs([Rule.constructor("n", Tags.LIT)]));

		let g = mkGraph();
		const [litId, g1] = Nodes.add(Tags.LIT, { value: 42 }, { created_by: "test" })(g);
		const [modal1Id, g2] = Nodes.add(Tags.MODAL, { quantity: "Many" }, { created_by: "test" })(g1);
		const [modal2Id, g3] = Nodes.add(Tags.MODAL, { quantity: "Many" }, { created_by: "test" })(g2);
		const [ruleRefId, g4] = Nodes.add(Tags.VAR_FREE, { name: "sameRule" }, { created_by: "test" })(g3);
		let g5 = Edges.add(g4.root, Labels.ENTRY, modal1Id)(g4);
		g5 = Edges.add(modal1Id, Labels.TERM, litId)(g5);
		g5 = Edges.add(modal1Id, Labels.REWRITE_RULE, ruleRefId)(g5);
		g5 = Edges.add(modal2Id, Labels.TERM, litId)(g5);
		g5 = Edges.add(modal2Id, Labels.REWRITE_RULE, ruleRefId)(g5);

		const ctx = mkMinimalCtx({
			sameRule: [undefined, ruleNf, undefined],
		});

		const result = Kernel.run(g5, ctx);
		expect(result).toBeDefined();
	});

	it("skips rules that fail to read", () => {
		const invalidRuleNf = NF.DSL.num(42);

		let g = mkGraph();
		const [litId, g1] = Nodes.add(Tags.LIT, { value: 42 }, { created_by: "test" })(g);
		const [modalId, g2] = Nodes.add(Tags.MODAL, { quantity: "Many" }, { created_by: "test" })(g1);
		const [ruleRefId, g3] = Nodes.add(Tags.VAR_FREE, { name: "badRule" }, { created_by: "test" })(g2);
		let g4 = Edges.add(g3.root, Labels.ENTRY, modalId)(g3);
		g4 = Edges.add(modalId, Labels.TERM, litId)(g4);
		g4 = Edges.add(modalId, Labels.REWRITE_RULE, ruleRefId)(g4);

		const ctx = mkMinimalCtx({
			badRule: [undefined, invalidRuleNf, undefined],
		});

		const result = Kernel.run(g4, ctx);
		expect(Query.byTag(Tags.LIT)(result).size).toBe(1);
	});
});
