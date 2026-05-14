import { describe, it, expect, beforeEach } from "vitest";
import { Nodes, Edges, Query, setRoot, empty, resetId } from "../graph";
import type { Rule } from "../grs";
import { Match, Rewrite, Strategy } from "../grs";

const prov = { created_by: "test" } as const;

describe("DPO matching", () => {
	beforeEach(resetId);

	it("matches a single node by tag", () => {
		const [, g] = Nodes.add("a", {}, prov)(empty);
		const rule: Rule = { lhs: { nodes: [{ bind: "$x", tag: "a" }], edges: [] }, rhs: { nodes: [], edges: [] } };
		expect(Match.one(rule, g)).toBeDefined();
	});

	it("matches node + edge", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g = Edges.add(a, ":x", b)(g2);

		const rule: Rule = {
			lhs: {
				nodes: [
					{ bind: "$a", tag: "a" },
					{ bind: "$b", tag: "b" },
				],
				edges: [{ source: "$a", label: ":x", target: "$b" }],
			},
			rhs: { nodes: [], edges: [] },
		};
		const m = Match.one(rule, g)!;
		expect(m.get("$a")).toBe(a);
		expect(m.get("$b")).toBe(b);
	});

	it("matches multiple edges", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const [c, g3] = Nodes.add("c", {}, prov)(g2);
		const g = Edges.add(a, ":y", c)(Edges.add(a, ":x", b)(g3));

		const rule: Rule = {
			lhs: {
				nodes: [
					{ bind: "$a", tag: "a" },
					{ bind: "$b", tag: "b" },
					{ bind: "$c", tag: "c" },
				],
				edges: [
					{ source: "$a", label: ":x", target: "$b" },
					{ source: "$a", label: ":y", target: "$c" },
				],
			},
			rhs: { nodes: [], edges: [] },
		};
		const m = Match.one(rule, g)!;
		expect(m.get("$a")).toBe(a);
		expect(m.get("$b")).toBe(b);
		expect(m.get("$c")).toBe(c);
	});

	it("matches self-referential edge", () => {
		const [a, g1] = Nodes.add("mu", {}, prov)(empty);
		const g = Edges.add(a, ":self", a)(g1);

		const rule: Rule = {
			lhs: {
				nodes: [{ bind: "$x", tag: "mu" }],
				edges: [{ source: "$x", label: ":self", target: "$x" }],
			},
			rhs: { nodes: [], edges: [] },
		};
		expect(Match.one(rule, g)).toBeDefined();
		expect(Match.one(rule, g)!.get("$x")).toBe(a);
	});

	it("rejects when edge missing", () => {
		const [, g1] = Nodes.add("a", {}, prov)(empty);
		const [, g] = Nodes.add("b", {}, prov)(g1);

		const rule: Rule = {
			lhs: {
				nodes: [
					{ bind: "$a", tag: "a" },
					{ bind: "$b", tag: "b" },
				],
				edges: [{ source: "$a", label: ":x", target: "$b" }],
			},
			rhs: { nodes: [], edges: [] },
		};
		expect(Match.one(rule, g)).toBeUndefined();
	});

	it("rejects when non-anchor node unreachable via edges", () => {
		const [, g1] = Nodes.add("a", {}, prov)(empty);
		const [, g] = Nodes.add("b", {}, prov)(g1);

		const rule: Rule = {
			lhs: {
				nodes: [
					{ bind: "$a", tag: "a" },
					{ bind: "$b", tag: "b" },
				],
				edges: [],
			},
			rhs: { nodes: [], edges: [] },
		};
		expect(Match.one(rule, g)).toBeUndefined();
	});

	it("where clause accepts", () => {
		const [, g] = Nodes.add("a", { v: 2 }, prov)(empty);
		const rule: Rule = {
			lhs: { nodes: [{ bind: "$x", tag: "a" }], edges: [] },
			rhs: { nodes: [], edges: [] },
			where: (b, g) => Nodes.get(b.get("$x") ?? -1)(g)?.payload.v === 2,
		};
		expect(Match.one(rule, g)).toBeDefined();
	});

	it("where clause rejects", () => {
		const [, g] = Nodes.add("a", { v: 1 }, prov)(empty);
		const rule: Rule = {
			lhs: { nodes: [{ bind: "$x", tag: "a" }], edges: [] },
			rhs: { nodes: [], edges: [] },
			where: (b, g) => Nodes.get(b.get("$x") ?? -1)(g)?.payload.v === 2,
		};
		expect(Match.one(rule, g)).toBeUndefined();
	});

	it("payload predicate accepts", () => {
		const [, g] = Nodes.add("a", { v: 42 }, prov)(empty);
		const rule: Rule = {
			lhs: { nodes: [{ bind: "$x", tag: "a", payload: p => p.v === 42 }], edges: [] },
			rhs: { nodes: [], edges: [] },
		};
		expect(Match.one(rule, g)).toBeDefined();
	});

	it("payload predicate rejects", () => {
		const [, g] = Nodes.add("a", { v: 1 }, prov)(empty);
		const rule: Rule = {
			lhs: { nodes: [{ bind: "$x", tag: "a", payload: p => p.v === 42 }], edges: [] },
			rhs: { nodes: [], edges: [] },
		};
		expect(Match.one(rule, g)).toBeUndefined();
	});

	it("matchAll finds multiple", () => {
		const [, g1] = Nodes.add("a", {}, prov)(empty);
		const [, g2] = Nodes.add("a", {}, prov)(g1);
		const [, g] = Nodes.add("a", {}, prov)(g2);

		const rule: Rule = { lhs: { nodes: [{ bind: "$x", tag: "a" }], edges: [] }, rhs: { nodes: [], edges: [] } };
		expect(Match.all(rule, g)).toHaveLength(3);
	});
});

describe("DPO rewrite", () => {
	beforeEach(resetId);

	it("deletes LHS-only nodes", () => {
		const [, g] = Nodes.add("old", {}, prov)(empty);
		const rule: Rule = {
			lhs: { nodes: [{ bind: "$x", tag: "old" }], edges: [] },
			rhs: { nodes: [], edges: [] },
		};
		const result = Rewrite.apply(rule, g)!;
		expect(result.nodes.size).toBe(0);
	});

	it("preserves interface nodes", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g = Edges.add(a, ":x", b)(g2);

		const rule: Rule = {
			lhs: {
				nodes: [
					{ bind: "$a", tag: "a" },
					{ bind: "$b", tag: "b" },
				],
				edges: [{ source: "$a", label: ":x", target: "$b" }],
			},
			rhs: { nodes: [{ bind: "$b", tag: "b", payload: {}, provenance: prov }], edges: [] },
		};
		const result = Rewrite.apply(rule, g)!;
		expect(result.nodes.size).toBe(1);
		expect(Nodes.get(b)(result)?.tag).toBe("b");
	});

	it("external edges to interface nodes survive", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const [ext, g3] = Nodes.add("ext", {}, prov)(g2);
		const g = Edges.add(ext, ":ref", b)(Edges.add(a, ":x", b)(g3));

		const rule: Rule = {
			lhs: {
				nodes: [
					{ bind: "$a", tag: "a" },
					{ bind: "$b", tag: "b" },
				],
				edges: [{ source: "$a", label: ":x", target: "$b" }],
			},
			rhs: { nodes: [{ bind: "$b", tag: "b", payload: {}, provenance: prov }], edges: [] },
		};
		const result = Rewrite.apply(rule, g)!;
		expect(Nodes.get(ext)(result)).toBeDefined();
		expect(Edges.byLabel(ext, ":ref")(result)?.target).toBe(b);
	});

	it("creates RHS-only nodes", () => {
		const [, g] = Nodes.add("old", {}, prov)(empty);
		const rule: Rule = {
			lhs: { nodes: [{ bind: "$x", tag: "old" }], edges: [] },
			rhs: { nodes: [{ bind: "$new", tag: "new", payload: { replaced: true }, provenance: prov }], edges: [] },
		};
		const result = Rewrite.apply(rule, g)!;
		expect(Query.byTag("old")(result).size).toBe(0);
		expect(Query.byTag("new")(result).size).toBe(1);
	});

	it("creates RHS edges between interface and new nodes", () => {
		const [a, g] = Nodes.add("a", {}, prov)(empty);
		const rule: Rule = {
			lhs: { nodes: [{ bind: "$a", tag: "a" }], edges: [] },
			rhs: {
				nodes: [
					{ bind: "$a", tag: "a", payload: {}, provenance: prov },
					{ bind: "$b", tag: "b", payload: {}, provenance: prov },
				],
				edges: [{ source: "$a", label: ":child", target: "$b" }],
			},
		};
		const result = Rewrite.apply(rule, g)!;
		expect(result.nodes.size).toBe(2);
		expect(Edges.byLabel(a, ":child")(result)).toBeDefined();
	});

	it("rejects on dangling edges (DPO)", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const [c, g3] = Nodes.add("c", {}, prov)(g2);
		const g = Edges.add(c, ":y", b)(Edges.add(a, ":x", b)(g3));

		const rule: Rule = {
			lhs: {
				nodes: [
					{ bind: "$a", tag: "a" },
					{ bind: "$b", tag: "b" },
				],
				edges: [{ source: "$a", label: ":x", target: "$b" }],
			},
			rhs: { nodes: [{ bind: "$a", tag: "a", payload: {}, provenance: prov }], edges: [] },
		};
		expect(Rewrite.apply(rule, g)).toBeUndefined();
	});

	it("removes LHS edges not in RHS between interface nodes", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g = Edges.add(a, ":old", b)(g2);

		const rule: Rule = {
			lhs: {
				nodes: [
					{ bind: "$a", tag: "a" },
					{ bind: "$b", tag: "b" },
				],
				edges: [{ source: "$a", label: ":old", target: "$b" }],
			},
			rhs: {
				nodes: [
					{ bind: "$a", tag: "a", payload: {}, provenance: prov },
					{ bind: "$b", tag: "b", payload: {}, provenance: prov },
				],
				edges: [{ source: "$a", label: ":new", target: "$b" }],
			},
		};
		const result = Rewrite.apply(rule, g)!;
		expect(Edges.byLabel(a, ":old")(result)).toBeUndefined();
		expect(Edges.byLabel(a, ":new")(result)).toBeDefined();
	});

	it("computed payload in RHS", () => {
		const [, g] = Nodes.add("a", { v: 10 }, prov)(empty);
		const rule: Rule = {
			lhs: { nodes: [{ bind: "$x", tag: "a" }], edges: [] },
			rhs: {
				nodes: [
					{
						bind: "$y",
						tag: "b",
						payload: (b, host) => ({ doubled: ((Nodes.get(b.get("$x") ?? -1)(host)?.payload.v as number) ?? 0) * 2 }),
						provenance: prov,
					},
				],
				edges: [],
			},
		};
		const result = Rewrite.apply(rule, g)!;
		const n = [...Query.byTag("b")(result)].map(id => Nodes.get(id)(result)).find(Boolean);
		expect(n?.payload.doubled).toBe(20);
	});

	it("root cleared when root node deleted", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const g = setRoot(a)(g1);

		const rule: Rule = {
			lhs: { nodes: [{ bind: "$x", tag: "a" }], edges: [] },
			rhs: { nodes: [], edges: [] },
		};
		const result = Rewrite.apply(rule, g)!;
		expect(result.root).toBeUndefined();
	});

	it("root preserved when non-root node deleted", () => {
		const [a, g1] = Nodes.add("a", {}, prov)(empty);
		const [b, g2] = Nodes.add("b", {}, prov)(g1);
		const g = setRoot(a)(Edges.add(a, ":x", b)(g2));

		const rule: Rule = {
			lhs: {
				nodes: [
					{ bind: "$a", tag: "a" },
					{ bind: "$b", tag: "b" },
				],
				edges: [{ source: "$a", label: ":x", target: "$b" }],
			},
			rhs: { nodes: [{ bind: "$a", tag: "a", payload: {}, provenance: prov }], edges: [] },
		};
		const result = Rewrite.apply(rule, g)!;
		expect(result.root).toBe(a);
	});

	it("in-place retag via shared interface bind", () => {
		const [a, g1] = Nodes.add("old", { keep: true }, prov)(empty);
		const [b, g2] = Nodes.add("ref", {}, prov)(g1);
		const g = setRoot(a)(Edges.add(b, ":to", a)(g2));

		const rule: Rule = {
			lhs: { nodes: [{ bind: "$x", tag: "old" }], edges: [] },
			rhs: { nodes: [{ bind: "$x", tag: "new", payload: { keep: true }, provenance: prov }], edges: [] },
		};
		const result = Rewrite.apply(rule, g)!;

		expect(Nodes.get(a)(result)?.tag).toBe("new");
		expect(Nodes.get(a)(result)?.payload.keep).toBe(true);
		expect(Edges.byLabel(b, ":to")(result)?.target).toBe(a);
		expect(result.root).toBe(a);
	});
});

describe("DPO strategies", () => {
	beforeEach(resetId);

	const replace = (from: string, to: string): Rule => ({
		lhs: { nodes: [{ bind: "$x", tag: from }], edges: [] },
		rhs: { nodes: [{ bind: "$x", tag: to, payload: {}, provenance: prov }], edges: [] },
	});

	it("apply rewrites until exhaustion", () => {
		const [, g1] = Nodes.add("old", {}, prov)(empty);
		const [, g2] = Nodes.add("old", {}, prov)(g1);
		const [, g] = Nodes.add("old", {}, prov)(g2);

		const result = Strategy.apply(replace("old", "new"))(g);
		expect(Query.byTag("old")(result).size).toBe(0);
		expect(Query.byTag("new")(result).size).toBe(3);
	});

	it("apply stops on dangling rejection", () => {
		const [a, g1] = Nodes.add("target", {}, prov)(empty);
		const [b, g2] = Nodes.add("ext", {}, prov)(g1);
		const g = Edges.add(b, ":ref", a)(g2);

		const rule: Rule = {
			lhs: { nodes: [{ bind: "$x", tag: "target" }], edges: [] },
			rhs: { nodes: [], edges: [] },
		};
		const result = Strategy.apply(rule)(g);
		expect(Nodes.get(a)(result)).toBeDefined();
	});

	it("once rewrites one", () => {
		const [, g1] = Nodes.add("old", {}, prov)(empty);
		const [, g] = Nodes.add("old", {}, prov)(g1);

		const result = Strategy.once(replace("old", "new"))(g);
		expect(Query.byTag("old")(result).size).toBe(1);
		expect(Query.byTag("new")(result).size).toBe(1);
	});

	it("seq composes", () => {
		const [, g] = Nodes.add("a", {}, prov)(empty);
		const result = Strategy.seq(Strategy.apply(replace("a", "b")), Strategy.apply(replace("b", "c")))(g);
		expect(Query.byTag("c")(result).size).toBe(1);
	});

	it("try_ doesn't fail on no match", () => {
		const [, g] = Nodes.add("a", {}, prov)(empty);
		const result = Strategy.try_(replace("nope", "new"))(g);
		expect(Query.byTag("a")(result).size).toBe(1);
	});

	it("choice picks first matching rule", () => {
		const [, g] = Nodes.add("a", {}, prov)(empty);
		const result = Strategy.choice(replace("nope", "x"), replace("a", "found"))(g);
		expect(Query.byTag("found")(result).size).toBe(1);
	});

	it("repeat stops at fixpoint", () => {
		const [, g1] = Nodes.add("a", {}, prov)(empty);
		const [, g] = Nodes.add("b", {}, prov)(g1);

		const result = Strategy.repeat(Strategy.once(replace("a", "b")))(g);
		expect(Query.byTag("a")(result).size).toBe(0);
		expect(Query.byTag("b")(result).size).toBe(2);
	});
});
