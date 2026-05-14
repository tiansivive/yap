import { describe, it, expect, beforeEach } from "vitest";
import { Nodes, Edges, Query, setRoot, empty, resetId } from "../graph";
import { display } from "../display";

const prov = { created_by: "test" } as const;

describe("GRAM graph", () => {
	beforeEach(resetId);

	it("empty graph has no nodes", () => {
		expect(empty.nodes.size).toBe(0);
	});

	it("Nodes.add creates node with tag index", () => {
		const [id, g] = Nodes.add("lit", { value: 42 }, prov)(empty);
		expect(Nodes.get(id)(g)?.tag).toBe("lit");
		expect(Nodes.get(id)(g)?.payload.value).toBe(42);
		expect(Query.byTag("lit")(g).size).toBe(1);
	});

	it("Edges.add creates outgoing and reverse-lookupable", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g = Edges.add(a, ":child", b)(g2);

		expect(Edges.byLabel(a, ":child")(g)?.target).toBe(b);
		expect(Edges.to(b)(g).some(e => e.source === a && e.label === ":child")).toBe(true);
	});

	it("Edges.add overwrites existing label", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const [c, g3] = Nodes.add("c", {}, prov)(g2);
		const g = Edges.add(a, ":x", c)(Edges.add(a, ":x", b)(g3));

		expect(Edges.byLabel(a, ":x")(g)?.target).toBe(c);
	});

	it("Nodes.remove cleans up edges and index", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g = Edges.add(a, ":child", b)(g2);
		const result = Nodes.remove(a)(g);

		expect(Nodes.get(a)(result)).toBeUndefined();
		expect(Query.byTag("a")(result).size).toBe(0);
		expect(Edges.to(b)(result)).toHaveLength(0);
	});

	it("Edges.remove preserves nodes", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g = Edges.add(a, ":child", b)(g2);
		const result = Edges.remove(a, ":child")(g);

		expect(Nodes.get(a)(result)).toBeDefined();
		expect(Nodes.get(b)(result)).toBeDefined();
		expect(Edges.byLabel(a, ":child")(result)).toBeUndefined();
		expect(Edges.to(b)(result)).toHaveLength(0);
	});

	it("Query.follow walks a path", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const [c, g3] = Nodes.add("c", {}, prov)(g2);
		const g = Edges.add(b, ":y", c)(Edges.add(a, ":x", b)(g3));

		expect(Query.follow(a, ":x", ":y")(g)).toBe(c);
		expect(Query.follow(a, ":x", ":z")(g)).toBeUndefined();
	});

	it("Query.byTag returns empty set for unknown tag", () => {
		expect(Query.byTag("nope")(empty).size).toBe(0);
	});

	it("Query.subgraph extracts induced subgraph", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const [c, g3] = Nodes.add("c", {}, prov)(g2);
		const g = Edges.add(a, ":z", c)(Edges.add(b, ":y", c)(Edges.add(a, ":x", b)(g3)));

		const sub = Query.subgraph(new Set([a, b]))(g);
		expect(sub.nodes.size).toBe(2);
		expect(Edges.byLabel(a, ":x")(sub)?.target).toBe(b);
		expect(Edges.byLabel(a, ":z")(sub)).toBeUndefined();
	});

	it("setRoot and display include root", () => {
		const [a, g1] = Nodes.add("lit", { value: 1 }, prov)(empty);
		const g = setRoot(a)(g1);
		expect(g.root).toBe(a);
		expect(display(g)).toContain("root:");
	});

	it("immutability — Nodes.add does not mutate original", () => {
		const [, g] = Nodes.add("a", {}, prov)(empty);
		expect(empty.nodes.size).toBe(0);
		expect(g.nodes.size).toBe(1);
	});
});
