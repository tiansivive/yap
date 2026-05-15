import type { Graph, NodeId } from "../graph";
import { Nodes, Edges } from "../graph";
import type { Rule, Edge, Bindings } from "./rule";
import { iface, lhsOnly, edgeInRhs } from "./rule";
import { Match } from "./match";

// ── Helpers ──

const resolve = (bindings: Bindings, bind: string): NodeId | undefined => bindings.get(bind);

// ── Pushout steps ──

const Dangling = {
	check: (toDelete: ReadonlyArray<string>, bindings: Bindings, redirects: Record<string, string>, host: Graph): boolean => {
		const matched = new Set(bindings.values());
		return toDelete.some(bind => {
			if (redirects[bind]) {
				return false;
			}
			const id = resolve(bindings, bind);
			return id !== undefined && Edges.to(id)(host).some(e => !matched.has(e.source));
		});
	},
};

const Redirect = {
	edges: (toDelete: ReadonlyArray<string>, bindings: Bindings, redirectMap: Record<string, string>, extended: Map<string, NodeId>, g: Graph): Graph =>
		toDelete.reduce((acc, bind) => {
			const target = redirectMap[bind];

			if (!target) {
				return acc;
			}

			const oldId = resolve(bindings, bind);
			const newId = extended.get(target);

			if (oldId === undefined || newId === undefined) {
				return acc;
			}

			return Edges.to(oldId)(acc).reduce((a, e) => Edges.add(e.source, e.label, newId, e.payload)(a), acc);
		}, g),
};

const Remove = {
	staleEdges: (rule: Rule, bindings: Bindings, g: Graph): Graph =>
		rule.lhs.edges
			.filter(e => !edgeInRhs(e, rule.rhs))
			.reduce((acc, e) => {
				const src = resolve(bindings, e.source);
				const tgt = resolve(bindings, e.target);

				if (src === undefined || tgt === undefined) {
					return acc;
				}

				const payloadKey = e.payload ? JSON.stringify(e.payload) : undefined;
				const hostEdge = Edges.byLabel(
					src,
					e.label,
				)(acc).find(he => he.target === tgt && (payloadKey === undefined || JSON.stringify(he.payload) === payloadKey));
				return hostEdge ? Edges.remove(hostEdge)(acc) : acc;
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
			.filter(n => k.has(n.bind) && n.tag !== undefined)
			.reduce((acc, n) => {
				const id = resolve(bindings, n.bind);

				if (id === undefined || !n.tag) {
					return acc;
				}
				const p = typeof n.payload === "function" ? n.payload(bindings, host) : (n.payload ?? {});
				return Nodes.retag(id, n.tag, p, n.provenance ?? { created_by: "rewrite" })(acc);
			}, g),
};

const Create = {
	nodes: (rule: Rule, k: Set<string>, bindings: Bindings, host: Graph, g: Graph): [Map<string, NodeId>, Graph] =>
		rule.rhs.nodes
			.filter(n => !k.has(n.bind) && n.tag !== undefined)
			.reduce<[Map<string, NodeId>, Graph]>(
				([ext, acc], n) => {
					const p = typeof n.payload === "function" ? n.payload(bindings, host) : (n.payload ?? {});
					const [id, next] = Nodes.add(n.tag ?? "", p, n.provenance ?? { created_by: "rewrite" })(acc);
					ext.set(n.bind, id);
					return [ext, next];
				},
				[new Map(bindings), g],
			),

	edges: (edges: ReadonlyArray<Edge>, bindings: Map<string, NodeId>, g: Graph): Graph =>
		edges.reduce((acc, e) => {
			const src = bindings.get(e.source);
			const tgt = bindings.get(e.target);
			return src !== undefined && tgt !== undefined ? Edges.add(src, e.label, tgt, e.payload ?? {})(acc) : acc;
		}, g),
};

// ── Public ──

export const apply = (rule: Rule, host: Graph, bindings?: Bindings): Graph | undefined => {
	const b = bindings ?? Match.one(rule, host);

	if (!b) {
		return undefined;
	}

	const toDelete = lhsOnly(rule);
	const redirects = rule.redirect ?? {};

	if (Dangling.check(toDelete, b, redirects, host)) {
		return undefined;
	}

	const k = iface(rule);
	const g1 = Remove.staleEdges(rule, b, host);
	const g2 = Update.interfaceNodes(rule, k, b, host, g1);
	const [extended, g3] = Create.nodes(rule, k, b, host, g2);
	const g4 = Redirect.edges(toDelete, b, redirects, extended, g3);
	const g5 = Remove.nodes(toDelete, b, g4);
	return Create.edges(rule.rhs.edges, extended, g5);
};
