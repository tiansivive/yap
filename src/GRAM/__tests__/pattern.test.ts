import { describe, it, expect, beforeEach } from "vitest";
import * as EB from "@yap/elaboration";

import { translate } from "../translate";
import { display } from "../display";
import { resetId, Query, Nodes, Edges } from "../graph";
import { Tags, Labels } from "../vocabulary";
import { compilePatterns } from "../passes/pattern";

const reset = () => {
	EB.resetId();
	resetId();
};

const run = (term: EB.Term) => compilePatterns(translate(term));

describe("pattern compilation pass", () => {
	beforeEach(reset);

	describe("variant patterns", () => {
		it("Some/None — switch on tag, two branches", () => {
			const scrutinee = EB.DSL.struct([
				{ label: "__tag", value: EB.DSL.type("Some") },
				{ label: "payload", value: EB.DSL.num(42) },
			]);
			const term = EB.DSL.match(scrutinee, [
				{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
				{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
			]);
			const g = run(term);

			expect(Query.byTag(Tags.SWITCH)(g).size).toBe(1);
			expect(Query.byTag(Tags.LEAF)(g).size).toBe(2);

			const switchId = [...Query.byTag(Tags.SWITCH)(g)][0];
			const switchNode = Nodes.get(switchId)(g);
			expect(switchNode?.payload.kind).toBe("tag");

			const branches = Edges.byLabel(switchId, Labels.BRANCH)(g);
			expect(branches.length).toBe(2);
			expect(branches.map(e => e.payload.label).sort()).toEqual(["None", "Some"]);

			expect(Edges.one(switchId, Labels.INSPECT)(g)).toBeDefined();

			const someBranch = branches.find(e => e.payload.label === "Some")!;
			const someLeaf = someBranch.target;
			const binds = Edges.byLabel(someLeaf, Labels.BIND)(g);
			expect(binds.length).toBe(1);
			expect(binds[0].payload.name).toBe("x");

			expect(display(g)).toMatchSnapshot();
		});

		it("variant with wildcard default — default branch present", () => {
			const scrutinee = EB.DSL.num(1);
			const term = EB.DSL.match(scrutinee, [
				{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
				{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(0) },
			]);
			const g = run(term);

			const switchId = [...Query.byTag(Tags.SWITCH)(g)][0];
			expect(Edges.one(switchId, Labels.DEFAULT)(g)).toBeDefined();

			const branches = Edges.byLabel(switchId, Labels.BRANCH)(g);
			expect(branches.length).toBe(1);
			expect(branches[0].payload.label).toBe("Some");

			expect(display(g)).toMatchSnapshot();
		});
	});

	describe("literal patterns", () => {
		it("0 / _ — switch on literal, default fallthrough", () => {
			const term = EB.DSL.lambda(
				"n",
				EB.DSL.match(EB.DSL.bound(0), [
					{ pattern: EB.Constructors.Patterns.Lit({ type: "Num", value: 0 }), term: EB.DSL.num(1) },
					{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(2) },
				]),
				EB.DSL.type("Num"),
			);
			const g = run(term);

			expect(Query.byTag(Tags.SWITCH)(g).size).toBe(1);
			expect(Query.byTag(Tags.LEAF)(g).size).toBe(2);

			const switchId = [...Query.byTag(Tags.SWITCH)(g)][0];
			expect(Nodes.get(switchId)(g)?.payload.kind).toBe("lit");

			const branches = Edges.byLabel(switchId, Labels.BRANCH)(g);
			expect(branches.length).toBe(1);
			expect(Edges.one(switchId, Labels.DEFAULT)(g)).toBeDefined();

			expect(display(g)).toMatchSnapshot();
		});

		it("multiple literals — distinct branches", () => {
			const term = EB.DSL.lambda(
				"n",
				EB.DSL.match(EB.DSL.bound(0), [
					{ pattern: EB.Constructors.Patterns.Lit({ type: "Num", value: 0 }), term: EB.DSL.num(10) },
					{ pattern: EB.Constructors.Patterns.Lit({ type: "Num", value: 1 }), term: EB.DSL.num(20) },
					{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(30) },
				]),
				EB.DSL.type("Num"),
			);
			const g = run(term);

			const switchId = [...Query.byTag(Tags.SWITCH)(g)][0];
			const branches = Edges.byLabel(switchId, Labels.BRANCH)(g);
			expect(branches.length).toBe(2);
			expect(Edges.one(switchId, Labels.DEFAULT)(g)).toBeDefined();

			expect(display(g)).toMatchSnapshot();
		});
	});

	describe("wildcard / binder patterns", () => {
		it("single wildcard — direct leaf, no switch", () => {
			const term = EB.DSL.match(EB.DSL.num(42), [{ pattern: EB.Constructors.Patterns.Wildcard(), term: EB.DSL.num(0) }]);
			const g = run(term);

			expect(Query.byTag(Tags.SWITCH)(g).size).toBe(0);
			expect(Query.byTag(Tags.LEAF)(g).size).toBe(1);

			expect(display(g)).toMatchSnapshot();
		});

		it("single binder — leaf with bind, no switch", () => {
			const term = EB.DSL.match(EB.DSL.num(42), [{ pattern: EB.Constructors.Patterns.Binder("x"), term: EB.DSL.bound(0) }]);
			const g = run(term);

			expect(Query.byTag(Tags.SWITCH)(g).size).toBe(0);
			expect(Query.byTag(Tags.LEAF)(g).size).toBe(1);

			const leafId = [...Query.byTag(Tags.LEAF)(g)][0];
			const binds = Edges.byLabel(leafId, Labels.BIND)(g);
			expect(binds.length).toBe(1);
			expect(binds[0].payload.name).toBe("x");

			expect(display(g)).toMatchSnapshot();
		});
	});

	describe("struct patterns", () => {
		it("struct with field patterns — expands to nested switch", () => {
			const pat = EB.Constructors.Patterns.Struct({
				type: "extension",
				label: "x",
				value: EB.Constructors.Patterns.Lit({ type: "Num", value: 1 }),
				row: {
					type: "extension",
					label: "y",
					value: EB.Constructors.Patterns.Binder("b"),
					row: { type: "empty" },
				},
			});
			const term = EB.DSL.match(EB.DSL.num(1), [{ pattern: pat, term: EB.DSL.bound(0) }]);
			const g = run(term);

			const switches = [...Query.byTag(Tags.SWITCH)(g)];
			expect(switches.length).toBeGreaterThanOrEqual(1);
			expect(Query.byTag(Tags.LEAF)(g).size).toBeGreaterThanOrEqual(1);

			expect(display(g)).toMatchSnapshot();
		});
	});

	describe("provenance preservation", () => {
		it("original match/case/pat nodes preserved after compilation", () => {
			const scrutinee = EB.DSL.num(1);
			const term = EB.DSL.match(scrutinee, [
				{ pattern: EB.DSL.Pat.variant("Some", EB.Constructors.Patterns.Binder("x")), term: EB.DSL.bound(0) },
				{ pattern: EB.DSL.Pat.variant("None", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(0) },
			]);
			const g = run(term);

			expect(Query.byTag(Tags.MATCH)(g).size).toBe(1);
			expect(Query.byTag(Tags.CASE)(g).size).toBe(2);
			expect(Query.byTag(Tags.PAT_VARIANT)(g).size).toBe(2);
		});
	});

	describe("edge cases", () => {
		it("no match nodes — pass is identity", () => {
			const g = run(EB.DSL.num(42));
			expect(Query.byTag(Tags.SWITCH)(g).size).toBe(0);
			expect(Query.byTag(Tags.LEAF)(g).size).toBe(0);
		});

		it("match keeps position — :compiled edge links to decision tree", () => {
			const scrutinee = EB.DSL.num(1);
			const term = EB.DSL.match(scrutinee, [
				{ pattern: EB.DSL.Pat.variant("A", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(1) },
				{ pattern: EB.DSL.Pat.variant("B", EB.Constructors.Patterns.Wildcard()), term: EB.DSL.num(2) },
			]);
			const g = run(term);

			const entryEdge = Edges.one(g.root, Labels.ENTRY)(g);
			expect(entryEdge).toBeDefined();
			expect(Nodes.get(entryEdge!.target)(g)?.tag).toBe(Tags.MATCH);

			const matchId = entryEdge!.target;
			const dtEdge = Edges.one(matchId, Labels.DECISION_TREE)(g);
			expect(dtEdge).toBeDefined();
			expect(Nodes.get(dtEdge!.target)(g)?.tag).toBe(Tags.SWITCH);
		});
	});
});
