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

	it("Edges.add creates outgoing and incoming", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g3 = Edges.add(a, ":child", b)(g2);

		expect(Edges.byLabel(a, ":child")(g3)?.target).toBe(b);
		expect(Edges.incoming(b)(g3).get(":child")).toBe(a);
	});

	it("Edges.add overwrites existing label", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const [c, g3] = Nodes.add("c", {}, prov)(g2);
		const g4 = Edges.add(a, ":x", b)(g3);
		const g5 = Edges.add(a, ":x", c)(g4);

		expect(Edges.byLabel(a, ":x")(g5)?.target).toBe(c);
		expect(Edges.incoming(b)(g5).has(":x")).toBe(false);
		expect(Edges.incoming(c)(g5).get(":x")).toBe(a);
	});

	it("Nodes.remove cleans up edges and index", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g3 = Edges.add(a, ":child", b)(g2);
		const g4 = Nodes.remove(a)(g3);

		expect(Nodes.get(a)(g4)).toBeUndefined();
		expect(Query.byTag("a")(g4).size).toBe(0);
		expect(Edges.incoming(b)(g4).size).toBe(0);
	});

	it("Edges.remove preserves nodes", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g3 = Edges.add(a, ":child", b)(g2);
		const g4 = Edges.remove(a, ":child")(g3);

		expect(Nodes.get(a)(g4)).toBeDefined();
		expect(Nodes.get(b)(g4)).toBeDefined();
		expect(Edges.byLabel(a, ":child")(g4)).toBeUndefined();
		expect(Edges.incoming(b)(g4).size).toBe(0);
	});

	it("Query.follow walks a path", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const [c, g3] = Nodes.add("c", {}, prov)(g2);
		const g4 = Edges.add(a, ":x", b)(g3);
		const g5 = Edges.add(b, ":y", c)(g4);

		expect(Query.follow(a, ":x", ":y")(g5)).toBe(c);
		expect(Query.follow(a, ":x", ":z")(g5)).toBeUndefined();
	});

	it("Query.byTag returns empty set for unknown tag", () => {
		expect(Query.byTag("nope")(empty).size).toBe(0);
	});

	it("Query.subgraph extracts induced subgraph", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const [c, g3] = Nodes.add("c", {}, prov)(g2);
		const g4 = Edges.add(a, ":x", b)(g3);
		const g5 = Edges.add(b, ":y", c)(g4);
		const g6 = Edges.add(a, ":z", c)(g5);

		const sub = Query.subgraph(new Set([a, b]))(g6);
		expect(sub.nodes.size).toBe(2);
		expect(Edges.byLabel(a, ":x")(sub)?.target).toBe(b);
		expect(Edges.byLabel(a, ":z")(sub)).toBeUndefined();
	});

	it("setRoot and display include root", () => {
		const [a, g1] = Nodes.add("lit", { value: 1 }, prov)(empty);
		const g2 = setRoot(a)(g1);
		expect(g2.root).toBe(a);
		expect(display(g2)).toContain("root:");
	});

	it("immutability — Nodes.add does not mutate original", () => {
		const [, g1] = Nodes.add("a", {}, prov)(empty);
		expect(empty.nodes.size).toBe(0);
		expect(g1.nodes.size).toBe(1);
	});
});
