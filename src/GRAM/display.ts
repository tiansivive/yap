import type { Graph, Node, NodeId, Payload } from "./graph";

const INDENT = "  ";

const d = {
	graph: (g: Graph): string => {
		const header = g.root !== undefined ? [`root: [${g.root}]`] : [];
		const nodes = [...g.nodes.values()].sort((a, b) => a.id - b.id).flatMap(n => [d.node(n), ...d.edges(g, n.id)]);
		return [...header, ...nodes].join("\n");
	},

	node: (n: Node): string => {
		const p = d.payload(n.payload);
		return `[${n.id}] ${n.tag}${p}`;
	},

	edges: (g: Graph, id: NodeId): string[] => {
		const out = g.edges.get(id);
		return out
			? [...out.values()]
					.sort((a, b) => a.label.localeCompare(b.label))
					.map(e => {
						const p = d.payload(e.payload);
						return `${INDENT}${e.label} -> [${e.target}]${p}`;
					})
			: [];
	},

	payload: (p: Payload): string => {
		const keys = Object.keys(p);
		return keys.length > 0 ? ` ${JSON.stringify(p)}` : "";
	},
};

export const display = d.graph;
