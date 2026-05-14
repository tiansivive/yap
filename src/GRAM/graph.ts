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

// TODO: consider a reverse-lookup index if scanning edges for incoming becomes a bottleneck

const edgesTo = (id: NodeId, g: Graph): ReadonlyArray<Edge> => [...g.edges.values()].flatMap(m => [...m.values()]).filter(e => e.target === id);

const dropOutgoingOf = (id: NodeId, g: Graph): Graph => {
	const edges = new Map(g.edges);
	edges.delete(id);
	return { ...g, edges };
};

const dropEdgesPointingTo = (id: NodeId, g: Graph): Graph => edgesTo(id, g).reduce((acc, e) => Edges.remove(e.source, e.label)(acc), g);

const dropAllEdgesOf = (id: NodeId, g: Graph): Graph => dropEdgesPointingTo(id, dropOutgoingOf(id, g));

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

	retag:
		(id: NodeId, tag: Tag, payload: Payload, provenance: Provenance) =>
		(g: Graph): Graph => {
			const old = g.nodes.get(id);

			if (!old) {
				return g;
			}
			const nodes = new Map(g.nodes);
			nodes.set(id, { id, tag, payload, provenance });
			const byTag = removeFromTagIndex(g, old.tag, id);
			return { ...g, nodes, byTag: addToTagIndex({ ...g, byTag }, tag, id) };
		},
};

// ── Edges ──

export const Edges = {
	add:
		(source: NodeId, label: Label, target: NodeId, payload: Payload = {}) =>
		(g: Graph): Graph => {
			const edge: Edge = { source, label, target, payload };
			return { ...g, edges: addOutgoing(g, edge) };
		},

	remove:
		(source: NodeId, label: Label) =>
		(g: Graph): Graph => {
			const srcMap = g.edges.get(source);

			if (!srcMap?.has(label)) {
				return g;
			}

			const updated = new Map(srcMap);
			updated.delete(label);
			const edges = new Map(g.edges);
			updated.size === 0 ? edges.delete(source) : edges.set(source, updated);
			return { ...g, edges };
		},

	outgoing:
		(id: NodeId) =>
		(g: Graph): ReadonlyMap<Label, Edge> =>
			g.edges.get(id) ?? new Map(),

	byLabel:
		(id: NodeId, label: Label) =>
		(g: Graph): Edge | undefined =>
			g.edges.get(id)?.get(label),

	to:
		(id: NodeId) =>
		(g: Graph): ReadonlyArray<Edge> =>
			edgesTo(id, g),
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
