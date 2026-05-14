import type { Graph, NodeId } from "../graph";
import { Nodes, Edges } from "../graph";
import type { Rule, Edge, Bindings } from "./rule";
import { iface, lhsOnly, edgeInRhs } from "./rule";
import { Match } from "./match";

// ── Helpers ──

const resolve = (bindings: Bindings, bind: string): NodeId | undefined => bindings.get(bind);

// ── Pushout steps ──

const Dangling = {
	check: (toDelete: ReadonlyArray<string>, bindings: Bindings, host: Graph): boolean => {
		const matched = new Set(bindings.values());
		return toDelete.some(bind => {
			const id = resolve(bindings, bind);
			return id !== undefined && Edges.to(id)(host).some(e => !matched.has(e.source));
		});
	},
};

const Remove = {
	staleEdges: (rule: Rule, bindings: Bindings, g: Graph): Graph =>
		rule.lhs.edges
			.filter(e => !edgeInRhs(e, rule.rhs))
			.reduce((acc, e) => {
				const src = resolve(bindings, e.source);
				return src !== undefined ? Edges.remove(src, e.label)(acc) : acc;
			}, g),

	nodes: (binds: ReadonlyArray<string>, bindings: Bindings, g: Graph): Graph =>
		binds.reduce((acc, bind) => {
			const id = resolve(bindings, bind);
			return id !== undefined ? Nodes.remove(id)(acc) : acc;
		}, g),
};

const Update = {
	interfaceNodes: (rule: Rule, k: Set<string>, bindings: Bindings, host: Graph, g: Graph): Graph =>
		rule.rhs.nodes
			.filter(n => k.has(n.bind))
			.reduce((acc, n) => {
				const id = resolve(bindings, n.bind);

				if (id === undefined) {
					return acc;
				}
				const p = typeof n.payload === "function" ? n.payload(bindings, host) : n.payload;
				return Nodes.retag(id, n.tag, p, n.provenance)(acc);
			}, g),
};

const Create = {
	nodes: (rule: Rule, k: Set<string>, bindings: Bindings, host: Graph, g: Graph): [Map<string, NodeId>, Graph] =>
		rule.rhs.nodes
			.filter(n => !k.has(n.bind))
			.reduce<[Map<string, NodeId>, Graph]>(
				([ext, acc], n) => {
					const p = typeof n.payload === "function" ? n.payload(bindings, host) : n.payload;
					const [id, next] = Nodes.add(n.tag, p, n.provenance)(acc);
					ext.set(n.bind, id);
					return [ext, next];
				},
				[new Map(bindings), g],
			),

	edges: (edges: ReadonlyArray<Edge>, bindings: Map<string, NodeId>, g: Graph): Graph =>
		edges.reduce((acc, e) => {
			const src = bindings.get(e.source);
			const tgt = bindings.get(e.target);
			return src !== undefined && tgt !== undefined ? Edges.add(src, e.label, tgt)(acc) : acc;
		}, g),
};

// ── Public ──

export const apply = (rule: Rule, host: Graph, bindings?: Bindings): Graph | undefined => {
	const b = bindings ?? Match.one(rule, host);

	if (!b) {
		return undefined;
	}

	const toDelete = lhsOnly(rule);

	if (Dangling.check(toDelete, b, host)) {
		return undefined;
	}

	const k = iface(rule);
	const g1 = Remove.staleEdges(rule, b, host);
	const g2 = Remove.nodes(toDelete, b, g1);
	const g3 = Update.interfaceNodes(rule, k, b, host, g2);
	const [extended, g4] = Create.nodes(rule, k, b, host, g3);
	return Create.edges(rule.rhs.edges, extended, g4);
};
