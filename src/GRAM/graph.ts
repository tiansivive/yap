import type { Provenance } from "./provenance";
import { Tags, Labels } from "./vocabulary";
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
	readonly edges: ReadonlyMap<NodeId, ReadonlyMap<Label, ReadonlyArray<Edge>>>;
	readonly byTag: ReadonlyMap<Tag, ReadonlySet<NodeId>>;
	readonly root: NodeId;
};

// ── Id supply ──

let _next = 0;
const fresh = (): NodeId => ++_next;
export const resetId = (): void => {
	_next = 0;
};

// ── Empty ──

export const mkGraph = (): Graph => {
	const id = fresh();
	const node: Node = { id, tag: Tags.ROOT, payload: {}, provenance: { created_by: "graph" } };
	const nodes: ReadonlyMap<NodeId, Node> = new Map([[id, node]]);
	const byTag: ReadonlyMap<string, ReadonlySet<NodeId>> = new Map([[Tags.ROOT, new Set([id])]]);
	return { nodes, edges: new Map(), byTag, root: id };
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

const addOutgoing = (g: Graph, e: Edge): ReadonlyMap<NodeId, ReadonlyMap<Label, ReadonlyArray<Edge>>> => {
	const all = new Map(g.edges);
	const src = new Map(g.edges.get(e.source));
	const existing = src.get(e.label) ?? [];
	const key = JSON.stringify(e.payload);
	if (existing.some(x => x.target === e.target && JSON.stringify(x.payload) === key)) {
		return g.edges;
	}
	src.set(e.label, [...existing, e]);
	all.set(e.source, src);
	return all;
};

// TODO: consider a reverse-lookup index if scanning edges for incoming becomes a bottleneck

const edgesTo = (id: NodeId, g: Graph): ReadonlyArray<Edge> => [...g.edges.values()].flatMap(m => [...m.values()].flat()).filter(e => e.target === id);

const dropOutgoingOf = (id: NodeId, g: Graph): Graph => {
	const edges = new Map(g.edges);
	edges.delete(id);
	return { ...g, edges };
};

const dropEdgesPointingTo = (id: NodeId, g: Graph): Graph => edgesTo(id, g).reduce((acc, e) => Edges.remove(e)(acc), g);

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
			return dropAllEdgesOf(id, { ...g, nodes, byTag });
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
		(edge: Edge) =>
		(g: Graph): Graph => {
			const srcMap = g.edges.get(edge.source);
			const arr = srcMap?.get(edge.label);

			if (!arr) {
				return g;
			}

			const key = JSON.stringify(edge.payload);
			const idx = arr.findIndex(e => e.target === edge.target && JSON.stringify(e.payload) === key);

			if (idx < 0) {
				return g;
			}

			const updated = new Map(srcMap);
			const newArr = [...arr.slice(0, idx), ...arr.slice(idx + 1)];
			newArr.length === 0 ? updated.delete(edge.label) : updated.set(edge.label, newArr);
			const edges = new Map(g.edges);
			updated.size === 0 ? edges.delete(edge.source) : edges.set(edge.source, updated);
			return { ...g, edges };
		},

	outgoing:
		(id: NodeId) =>
		(g: Graph): ReadonlyArray<Edge> =>
			[...(g.edges.get(id)?.values() ?? [])].flat(),

	byLabel:
		(id: NodeId, label: Label) =>
		(g: Graph): ReadonlyArray<Edge> =>
			g.edges.get(id)?.get(label) ?? [],

	one:
		(id: NodeId, label: Label) =>
		(g: Graph): Edge | undefined =>
			g.edges.get(id)?.get(label)?.[0],

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
			labels.reduce<NodeId | undefined>((cur, label) => (cur !== undefined ? g.edges.get(cur)?.get(label)?.[0]?.target : undefined), id),

	any:
		(from: NodeId, pred: (edge: Edge) => boolean, follow?: (edge: Edge) => boolean) =>
		(g: Graph): boolean => {
			const visited = new Set<NodeId>();
			const shouldFollow = follow ?? (() => true);
			const walk = (id: NodeId): boolean => {
				if (visited.has(id)) {
					return false;
				}
				visited.add(id);
				const out = g.edges.get(id);

				if (!out) {
					return false;
				}
				return [...out.values()].flat().some(e => pred(e) || (shouldFollow(e) && walk(e.target)));
			};
			return walk(from);
		},

	collect:
		(from: NodeId, pred: (edge: Edge) => boolean, follow?: (edge: Edge) => boolean) =>
		(g: Graph): ReadonlyArray<Edge> => {
			const visited = new Set<NodeId>();
			const shouldFollow = follow ?? (() => true);
			const results: Edge[] = [];
			const walk = (id: NodeId): void => {
				if (visited.has(id)) {
					return;
				}
				visited.add(id);
				const out = g.edges.get(id);

				if (!out) {
					return;
				}
				[...out.values()].flat().forEach(e => {
					if (pred(e)) {
						results.push(e);
					}

					if (shouldFollow(e)) {
						walk(e.target);
					}
				});
			};
			walk(from);
			return results;
		},

	subgraph:
		(ids: ReadonlySet<NodeId>, root: NodeId) =>
		(g: Graph): Graph => {
			const seed = mkGraph();
			const withNodes = [...ids].reduce<Graph>((acc, id) => {
				const node = g.nodes.get(id);

				if (!node) {
					return acc;
				}
				const nodes = new Map(acc.nodes);
				nodes.set(id, node);
				const byTag = addToTagIndex(acc, node.tag, id);
				return { ...acc, nodes, byTag };
			}, seed);

			const withEdges = [...ids].reduce<Graph>((acc, id) => {
				const out = g.edges.get(id);

				if (!out) {
					return acc;
				}
				return [...out.values()]
					.flat()
					.filter(e => ids.has(e.target))
					.reduce((a, e) => Edges.add(e.source, e.label, e.target, e.payload)(a), acc);
			}, withNodes);

			return Edges.add(withEdges.root, Labels.ENTRY, root)(withEdges);
		},
};

// ── Root ──

export const entry = (g: Graph): NodeId | undefined => g.edges.get(g.root)?.get(Labels.ENTRY)?.[0]?.target;
