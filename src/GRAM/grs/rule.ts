import type { NodeId, Payload } from "../graph";
import type { Tag, Label } from "../vocabulary";
import type { Provenance } from "../provenance";
import type { Graph } from "../graph";

export type Bindings = ReadonlyMap<string, NodeId>;

export type Pattern = {
	readonly bind: string;
	readonly tag?: Tag;
	readonly payload?: (p: Payload) => boolean;
};

export type Constructor = {
	readonly bind: string;
	readonly tag: Tag;
	readonly payload: Payload | ((b: Bindings, host: Graph) => Payload);
	readonly provenance: Provenance;
};

export type Edge = {
	readonly source: string;
	readonly label: Label;
	readonly target: string;
};

export type Rule = {
	readonly lhs: { readonly nodes: ReadonlyArray<Pattern>; readonly edges: ReadonlyArray<Edge> };
	readonly rhs: { readonly nodes: ReadonlyArray<Constructor>; readonly edges: ReadonlyArray<Edge> };
	readonly where?: (b: Bindings, host: Graph) => boolean;
};

// ── Analysis ──

const bindsOf = (nodes: ReadonlyArray<{ bind: string }>): Set<string> => new Set(nodes.map(n => n.bind));

export const iface = (rule: Rule): Set<string> => {
	const r = bindsOf(rule.rhs.nodes);
	return new Set([...bindsOf(rule.lhs.nodes)].filter(b => r.has(b)));
};

export const lhsOnly = (rule: Rule): ReadonlyArray<string> => {
	const k = iface(rule);
	return [...bindsOf(rule.lhs.nodes)].filter(b => !k.has(b));
};

export const edgeInRhs = (e: Edge, rhs: Rule["rhs"]): boolean => rhs.edges.some(r => r.source === e.source && r.label === e.label && r.target === e.target);
