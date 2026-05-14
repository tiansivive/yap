import type { Graph, NodeId, Payload } from "./graph";
import { Nodes, Edges } from "./graph";
import type { Tag, Label } from "./vocabulary";

// ── Types ──

export type NodePattern =
	| { readonly kind: "tag"; readonly tag: Tag; readonly edges?: ReadonlyArray<EdgePattern>; readonly payload?: (p: Payload) => boolean; readonly bind?: string }
	| { readonly kind: "any"; readonly bind?: string }
	| { readonly kind: "ref"; readonly name: string };

export type EdgePattern = {
	readonly label: Label;
	readonly target: NodePattern;
};

export type Bindings = ReadonlyMap<string, NodeId>;

export type Match = {
	readonly root: NodeId;
	readonly bindings: Bindings;
};

// ── Matching ──

export const matchAll =
	(pattern: NodePattern) =>
	(g: Graph): ReadonlyArray<Match> => {
		const candidates = pattern.kind === "tag" ? (g.byTag.get(pattern.tag) ?? new Set()) : new Set(g.nodes.keys());

		const results: Match[] = [];
		for (const id of candidates) {
			const bindings = attempt(g, pattern, id, new Map());

			if (bindings) {
				results.push({ root: id, bindings });
			}
		}
		return results;
	};

export const matchAt =
	(pattern: NodePattern, id: NodeId) =>
	(g: Graph): Match | undefined => {
		const bindings = attempt(g, pattern, id, new Map());
		return bindings ? { root: id, bindings } : undefined;
	};

// ── Internal ──

const attempt = (g: Graph, p: NodePattern, id: NodeId, bound: Map<string, NodeId>): Bindings | undefined => {
	const node = Nodes.get(id)(g);

	if (!node) {
		return undefined;
	}

	if (p.kind === "ref") {
		return bound.get(p.name) === id ? new Map(bound) : undefined;
	}

	if (p.kind === "tag") {
		if (node.tag !== p.tag) {
			return undefined;
		}

		if (p.payload && !p.payload(node.payload)) {
			return undefined;
		}
	}

	let acc = new Map(bound);

	const name = p.kind === "tag" ? p.bind : p.kind === "any" ? p.bind : undefined;
	if (name) {
		if (acc.has(name) && acc.get(name) !== id) {
			return undefined;
		}
		acc.set(name, id);
	}

	if (p.kind === "tag" && p.edges) {
		for (const ep of p.edges) {
			const edge = Edges.byLabel(id, ep.label)(g);

			if (!edge) {
				return undefined;
			}
			const child = attempt(g, ep.target, edge.target, acc);

			if (!child) {
				return undefined;
			}
			acc = new Map(child);
		}
	}

	return acc;
};
