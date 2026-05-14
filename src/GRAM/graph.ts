import type { Provenance } from "./provenance";
import type { Tag, Label } from "./vocabulary";

export type NodeId = number;
export type Payload = Readonly<Record<string, unknown>>;

export type Node = {
	readonly id: NodeId;
	readonly tag: Tag;
	readonly payload: Payload;
	readonly provenance: Provenance;
};

export type Edge = {
	readonly source: NodeId;
	readonly label: Label;
	readonly target: NodeId;
	readonly payload: Payload;
};

export type Graph = {
	readonly nodes: ReadonlyMap<NodeId, Node>;
	readonly edges: ReadonlyMap<NodeId, ReadonlyMap<Label, Edge>>;
	readonly incoming: ReadonlyMap<NodeId, ReadonlyMap<Label, NodeId>>;
	readonly byTag: ReadonlyMap<Tag, ReadonlySet<NodeId>>;
	readonly root?: NodeId;
};

// ── Id supply ──

let _next = 0;
const fresh = (): NodeId => ++_next;
export const resetId = (): void => {
	_next = 0;
};

// ── Empty ──

export const empty: Graph = {
	nodes: new Map(),
	edges: new Map(),
	incoming: new Map(),
	byTag: new Map(),
};

// ── Internal index helpers ──

const addToTagIndex = (g: Graph, tag: Tag, id: NodeId): ReadonlyMap<Tag, ReadonlySet<NodeId>> => {
	const idx = new Map(g.byTag);
	const set = new Set(g.byTag.get(tag));
	set.add(id);
	idx.set(tag, set);
	return idx;
};

const removeFromTagIndex = (g: Graph, tag: Tag, id: NodeId): ReadonlyMap<Tag, ReadonlySet<NodeId>> => {
	const idx = new Map(g.byTag);
	const set = new Set(g.byTag.get(tag));
	set.delete(id);
	set.size === 0 ? idx.delete(tag) : idx.set(tag, set);
	return idx;
};

const addOutgoing = (g: Graph, e: Edge): ReadonlyMap<NodeId, ReadonlyMap<Label, Edge>> => {
	const all = new Map(g.edges);
	const src = new Map(g.edges.get(e.source));
	src.set(e.label, e);
	all.set(e.source, src);
	return all;
};

const addIncoming = (g: Graph, label: Label, source: NodeId, target: NodeId): ReadonlyMap<NodeId, ReadonlyMap<Label, NodeId>> => {
	const all = new Map(g.incoming);
	const tgt = new Map(g.incoming.get(target));
	tgt.set(label, source);
	all.set(target, tgt);
	return all;
};

const dropIncoming = (g: Graph, label: Label, target: NodeId): ReadonlyMap<NodeId, ReadonlyMap<Label, NodeId>> => {
	const all = new Map(g.incoming);
	const tgt = new Map(g.incoming.get(target));
	tgt.delete(label);
	tgt.size === 0 ? all.delete(target) : all.set(target, tgt);
	return all;
};

const dropAllEdgesOf = (id: NodeId, g: Graph): Graph => {
	const out = g.edges.get(id);
	let result = g;

	if (out) {
		let inc = result.incoming;

		for (const [, e] of out) {
			inc = dropIncoming({ ...result, incoming: inc }, e.label, e.target);
		}
		const edges = new Map(result.edges);
		edges.delete(id);
		result = { ...result, edges, incoming: inc };
	}

	const inc = result.incoming.get(id);
	if (inc) {
		let edges = new Map(result.edges);
		for (const [label, src] of inc) {
			const srcMap = new Map(edges.get(src));
			srcMap.delete(label);
			srcMap.size === 0 ? edges.delete(src) : edges.set(src, srcMap);
		}
		const incoming = new Map(result.incoming);
		incoming.delete(id);
		result = { ...result, edges, incoming };
	}

	return result;
};

// ── Nodes ──

export const Nodes = {
	add:
		(tag: Tag, payload: Payload, provenance: Provenance) =>
		(g: Graph): [NodeId, Graph] => {
			const id = fresh();
			const node: Node = { id, tag, payload, provenance };
			const nodes = new Map(g.nodes);
			nodes.set(id, node);
			return [id, { ...g, nodes, byTag: addToTagIndex(g, tag, id) }];
		},

	remove:
		(id: NodeId) =>
		(g: Graph): Graph => {
			const node = g.nodes.get(id);

			if (!node) {
				return g;
			}

			const nodes = new Map(g.nodes);
			nodes.delete(id);
			const byTag = removeFromTagIndex(g, node.tag, id);
			const cleaned = dropAllEdgesOf(id, { ...g, nodes, byTag });
			return cleaned.root === id ? { ...cleaned, root: undefined } : cleaned;
		},

	get:
		(id: NodeId) =>
		(g: Graph): Node | undefined =>
			g.nodes.get(id),
};

// ── Edges ──

export const Edges = {
	add:
		(source: NodeId, label: Label, target: NodeId, payload: Payload = {}) =>
		(g: Graph): Graph => {
			const prev = g.edges.get(source)?.get(label);
			const edge: Edge = { source, label, target, payload };
			const edges = addOutgoing(g, edge);
			const inc = prev && prev.target !== target ? dropIncoming({ ...g, incoming: g.incoming }, label, prev.target) : g.incoming;
			return { ...g, edges, incoming: addIncoming({ ...g, incoming: inc }, label, source, target) };
		},

	remove:
		(source: NodeId, label: Label) =>
		(g: Graph): Graph => {
			const edge = g.edges.get(source)?.get(label);

			if (!edge) {
				return g;
			}

			const src = new Map(g.edges.get(source)!);
			src.delete(label);
			const edges = new Map(g.edges);
			src.size === 0 ? edges.delete(source) : edges.set(source, src);

			return { ...g, edges, incoming: dropIncoming(g, label, edge.target) };
		},

	outgoing:
		(id: NodeId) =>
		(g: Graph): ReadonlyMap<Label, Edge> =>
			g.edges.get(id) ?? new Map(),

	byLabel:
		(id: NodeId, label: Label) =>
		(g: Graph): Edge | undefined =>
			g.edges.get(id)?.get(label),

	incoming:
		(id: NodeId) =>
		(g: Graph): ReadonlyMap<Label, NodeId> =>
			g.incoming.get(id) ?? new Map(),
};

// ── Query ──

export const Query = {
	byTag:
		(tag: Tag) =>
		(g: Graph): ReadonlySet<NodeId> =>
			g.byTag.get(tag) ?? new Set(),

	follow:
		(id: NodeId, ...labels: Label[]) =>
		(g: Graph): NodeId | undefined =>
			labels.reduce<NodeId | undefined>((cur, label) => (cur !== undefined ? g.edges.get(cur)?.get(label)?.target : undefined), id),

	subgraph:
		(ids: ReadonlySet<NodeId>) =>
		(g: Graph): Graph =>
			[...ids].reduce<Graph>((acc, id) => {
				const node = g.nodes.get(id);

				if (!node) {
					return acc;
				}
				const [, withNode] = Nodes.add(node.tag, node.payload, node.provenance)(acc);

				const out = g.edges.get(id);

				if (!out) {
					return withNode;
				}

				return [...out.values()].filter(e => ids.has(e.target)).reduce((a, e) => Edges.add(e.source, e.label, e.target, e.payload)(a), withNode);
			}, empty),
};

// ── Root ──

export const setRoot =
	(id: NodeId) =>
	(g: Graph): Graph => ({ ...g, root: id });
