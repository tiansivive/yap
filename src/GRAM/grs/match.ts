import type { Graph, NodeId } from "../graph";
import { Nodes, Edges, Query } from "../graph";
import type { Rule, LhsNode, RuleEdge, Bindings } from "./rule";

// ── Internal ──

const candidates = (anchor: LhsNode, host: Graph): ReadonlySet<NodeId> => (anchor.tag ? Query.byTag(anchor.tag)(host) : new Set(host.nodes.keys()));

const checkNode = (lhs: LhsNode, hostId: NodeId, host: Graph): boolean => {
	const node = Nodes.get(hostId)(host);

	if (!node) {
		return false;
	}

	if (lhs.tag && node.tag !== lhs.tag) {
		return false;
	}
	return !lhs.payload || lhs.payload(node.payload);
};

const bindNode = (lhs: LhsNode, hostId: NodeId, host: Graph, bound: Map<string, NodeId>, used: Set<NodeId>): boolean => {
	if (bound.has(lhs.bind)) {
		return bound.get(lhs.bind) === hostId;
	}

	if (used.has(hostId)) {
		return false;
	}

	if (!checkNode(lhs, hostId, host)) {
		return false;
	}
	bound.set(lhs.bind, hostId);
	used.add(hostId);
	return true;
};

const resolveEdge = (e: RuleEdge, rule: Rule, host: Graph, bound: Map<string, NodeId>, used: Set<NodeId>): boolean => {
	const srcId = bound.get(e.source);

	if (srcId === undefined) {
		return false;
	}

	const edge = Edges.byLabel(srcId, e.label)(host);

	if (!edge) {
		return false;
	}

	const target = rule.lhs.nodes.find(n => n.bind === e.target);
	return target !== undefined && bindNode(target, edge.target, host, bound, used);
};

const allBound = (nodes: ReadonlyArray<LhsNode>, bound: Map<string, NodeId>): boolean => nodes.every(n => bound.has(n.bind));

const tryAt = (rule: Rule, host: Graph, anchorId: NodeId): Bindings | undefined => {
	const bound = new Map<string, NodeId>();
	const used = new Set<NodeId>();

	if (!bindNode(rule.lhs.nodes[0], anchorId, host, bound, used)) {
		return undefined;
	}

	if (!rule.lhs.edges.every(e => resolveEdge(e, rule, host, bound, used))) {
		return undefined;
	}

	if (!allBound(rule.lhs.nodes, bound)) {
		return undefined;
	}

	if (rule.where && !rule.where(bound, host)) {
		return undefined;
	}

	return bound;
};

// ── Public ──

export const Match = {
	one: (rule: Rule, host: Graph): Bindings | undefined => {
		const anchor = rule.lhs.nodes[0];

		if (!anchor) {
			return new Map();
		}

		for (const id of candidates(anchor, host)) {
			const result = tryAt(rule, host, id);

			if (result) {
				return result;
			}
		}
		return undefined;
	},

	all: (rule: Rule, host: Graph): ReadonlyArray<Bindings> => {
		const anchor = rule.lhs.nodes[0];

		if (!anchor) {
			return [new Map()];
		}

		const results: Bindings[] = [];
		for (const id of candidates(anchor, host)) {
			const result = tryAt(rule, host, id);

			if (result) {
				results.push(result);
			}
		}
		return results;
	},
};
