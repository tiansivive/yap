import { describe, it, expect, beforeEach } from "vitest";
import { Nodes, Edges, Query, mkGraph, entry, resetId } from "../graph";
import { display } from "../display";

const prov = { created_by: "test" } as const;

describe("GRAM graph", () => {
	beforeEach(resetId);

	it("mkGraph creates root node", () => {
		const g = mkGraph();
		expect(g.nodes.size).toBe(1);
		expect(Nodes.get(g.root)(g)?.tag).toBe("root");
	});

	it("Nodes.add creates node with tag index", () => {
		const g = mkGraph();
		const [id, g2] = Nodes.add("lit", { value: 42 }, prov)(g);
		expect(Nodes.get(id)(g2)?.tag).toBe("lit");
		expect(Nodes.get(id)(g2)?.payload.value).toBe(42);
		expect(Query.byTag("lit")(g2).size).toBe(1);
	});

	it("Edges.add creates outgoing and reverse-lookupable", () => {
		const g = mkGraph();
		const [a, g1] = Nodes.add("a", {}, prov)(g);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g3 = Edges.add(a, ":child", b)(g2);

		expect(Edges.byLabel(a, ":child")(g3)?.target).toBe(b);
		expect(Edges.to(b)(g3).some(e => e.source === a && e.label === ":child")).toBe(true);
	});

	it("Edges.add overwrites existing label", () => {
		const g = mkGraph();
		const [a, g1] = Nodes.add("a", {}, prov)(g);
		const [, g2] = Nodes.add("b", {}, prov)(g1);
		const [c, g3] = Nodes.add("c", {}, prov)(g2);
		const g4 = Edges.add(a, ":x", c)(Edges.add(a, ":x", c)(g3));

		expect(Edges.byLabel(a, ":x")(g4)?.target).toBe(c);
	});

	it("Nodes.remove cleans up edges and index", () => {
		const g = mkGraph();
		const [a, g1] = Nodes.add("a", {}, prov)(g);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g3 = Edges.add(a, ":child", b)(g2);
		const result = Nodes.remove(a)(g3);

		expect(Nodes.get(a)(result)).toBeUndefined();
		expect(Query.byTag("a")(result).size).toBe(0);
		expect(Edges.to(b)(result)).toHaveLength(0);
	});

	it("Edges.remove preserves nodes", () => {
		const g = mkGraph();
		const [a, g1] = Nodes.add("a", {}, prov)(g);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g3 = Edges.add(a, ":child", b)(g2);
		const result = Edges.remove(a, ":child")(g3);

		expect(Nodes.get(a)(result)).toBeDefined();
		expect(Nodes.get(b)(result)).toBeDefined();
		expect(Edges.byLabel(a, ":child")(result)).toBeUndefined();
		expect(Edges.to(b)(result)).toHaveLength(0);
	});

	it("Query.follow walks a path", () => {
		const g = mkGraph();
		const [a, g1] = Nodes.add("a", {}, prov)(g);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const [c, g3] = Nodes.add("c", {}, prov)(g2);
		const g4 = Edges.add(b, ":y", c)(Edges.add(a, ":x", b)(g3));

		expect(Query.follow(a, ":x", ":y")(g4)).toBe(c);
		expect(Query.follow(a, ":x", ":z")(g4)).toBeUndefined();
	});

	it("Query.byTag returns empty set for unknown tag", () => {
		expect(Query.byTag("nope")(mkGraph()).size).toBe(0);
	});

	it("entry returns the node linked from root via :entry", () => {
		const g = mkGraph();
		const [a, g1] = Nodes.add("a", {}, prov)(g);
		const g2 = Edges.add(g.root, ":entry", a)(g1);
		expect(entry(g2)).toBe(a);
	});

	it("entry returns undefined when no :entry edge", () => {
		expect(entry(mkGraph())).toBeUndefined();
	});

	it("immutability — Nodes.add does not mutate original", () => {
		const g = mkGraph();
		const [, g2] = Nodes.add("a", {}, prov)(g);
		expect(g.nodes.size).toBe(1);
		expect(g2.nodes.size).toBe(2);
	});
});
