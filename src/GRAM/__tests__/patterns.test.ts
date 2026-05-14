import { describe, it, expect, beforeEach } from "vitest";
import { Nodes, Edges, setRoot, empty, resetId } from "../graph";
import type { NodePattern } from "../patterns";
import { matchAll, matchAt } from "../patterns";
import type { Rule } from "../rewrite";
import { applyOnce, apply } from "../rewrite";

const prov = { created_by: "test" } as const;

const buildSmallGraph = () => {
	const [lam, g1] = Nodes.add("lambda", { variable: "x" }, prov)(empty);
	const [body, g2] = Nodes.add("var:bound", { index: 0 }, prov)(g1);
	const [ann, g3] = Nodes.add("var:free", { name: "Int" }, prov)(g2);
	const g4 = Edges.add(lam, ":body", body)(g3);
	const g5 = Edges.add(lam, ":annotation", ann)(g4);
	const g6 = Edges.add(body, ":refers_to", lam)(g5);
	return { g: setRoot(lam)(g6), lam, body, ann };
};

describe("GRAM patterns", () => {
	beforeEach(resetId);

	it("matches a tag", () => {
		const { g, lam } = buildSmallGraph();
		const pattern: NodePattern = { kind: "tag", tag: "lambda" };
		const matches = matchAll(pattern)(g);
		expect(matches).toHaveLength(1);
		expect(matches[0].root).toBe(lam);
	});

	it("matches tag with edge", () => {
		const { g, body } = buildSmallGraph();
		const pattern: NodePattern = {
			kind: "tag",
			tag: "lambda",
			edges: [{ label: ":body", target: { kind: "any", bind: "$body" } }],
		};
		const matches = matchAll(pattern)(g);
		expect(matches).toHaveLength(1);
		expect(matches[0].bindings.get("$body")).toBe(body);
	});

	it("matches nested with back-reference", () => {
		const { g, lam } = buildSmallGraph();
		const pattern: NodePattern = {
			kind: "tag",
			tag: "lambda",
			bind: "$lam",
			edges: [
				{
					label: ":body",
					target: {
						kind: "tag",
						tag: "var:bound",
						edges: [{ label: ":refers_to", target: { kind: "ref", name: "$lam" } }],
					},
				},
			],
		};
		const matches = matchAll(pattern)(g);
		expect(matches).toHaveLength(1);
		expect(matches[0].bindings.get("$lam")).toBe(lam);
	});

	it("rejects missing edge", () => {
		const { g } = buildSmallGraph();
		const pattern: NodePattern = {
			kind: "tag",
			tag: "lambda",
			edges: [{ label: ":nonexistent", target: { kind: "any" } }],
		};
		expect(matchAll(pattern)(g)).toHaveLength(0);
	});

	it("rejects wrong tag", () => {
		const { g } = buildSmallGraph();
		expect(matchAll({ kind: "tag", tag: "pi" })(g)).toHaveLength(0);
	});

	it("payload predicate filters", () => {
		const { g } = buildSmallGraph();
		expect(matchAll({ kind: "tag", tag: "lambda", payload: p => p.variable === "y" })(g)).toHaveLength(0);
		expect(matchAll({ kind: "tag", tag: "lambda", payload: p => p.variable === "x" })(g)).toHaveLength(1);
	});

	it("matchAt checks specific node", () => {
		const { g, lam, body } = buildSmallGraph();
		const pattern: NodePattern = { kind: "tag", tag: "lambda" };
		expect(matchAt(pattern, lam)(g)).toBeDefined();
		expect(matchAt(pattern, body)(g)).toBeUndefined();
	});
});

describe("GRAM rewrite", () => {
	beforeEach(resetId);

	it("applyOnce rewrites first match", () => {
		const [, g1] = Nodes.add("old", { v: 1 }, prov)(empty);
		const [, g2] = Nodes.add("old", { v: 2 }, prov)(g1);

		const rule: Rule = {
			pattern: { kind: "tag", tag: "old", bind: "$n" },
			builder: (bindings, g) => {
				const id = bindings.get("$n")!;
				const node = Nodes.get(id)(g)!;
				const g2 = Nodes.remove(id)(g);
				const [, g3] = Nodes.add("new", node.payload, prov)(g2);
				return g3;
			},
		};

		const result = applyOnce(rule)(g2)!;
		expect(result).toBeDefined();
		expect(result.byTag.get("old")?.size ?? 0).toBe(1);
		expect(result.byTag.get("new")?.size ?? 0).toBe(1);
	});

	it("apply rewrites until exhaustion", () => {
		const [, g1] = Nodes.add("old", {}, prov)(empty);
		const [, g2] = Nodes.add("old", {}, prov)(g1);
		const [, g3] = Nodes.add("old", {}, prov)(g2);

		const rule: Rule = {
			pattern: { kind: "tag", tag: "old", bind: "$n" },
			builder: (bindings, g) => {
				const [, g2] = Nodes.add("new", {}, prov)(Nodes.remove(bindings.get("$n")!)(g));
				return g2;
			},
		};

		const result = apply(rule)(g3);
		expect(result.byTag.get("old")?.size ?? 0).toBe(0);
		expect(result.byTag.get("new")?.size ?? 0).toBe(3);
	});
});
