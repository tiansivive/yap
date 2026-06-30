import { Nodes, Edges, Query } from "../graph";
import type { Graph, NodeId } from "../graph";
import { Tags, Labels, isStructural } from "../vocabulary";
import type { Pass } from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";
import { none } from "../pipeline/descriptor";

// Classify cycles in a struct's label-reference graph. A reference is "guarded" when it sits
// under a lambda — read at call time, so the knot can be tied by backpatching. A cycle that
// passes through a lambda is a recursive function: admitted, and the struct is flagged so the
// bridge allocates-then-backpatches. A cycle made only of eager references (value-level codata
// or an ill-founded self-reference) has no construction order and is rejected.

type Ref = { readonly to: string; readonly guarded: boolean };
type Edge = { readonly from: string } & Ref;

const structuralChildren = (id: NodeId, g: Graph): ReadonlyArray<NodeId> =>
	Edges.outgoing(id)(g)
		.filter(e => isStructural(e.label) || e.label === Labels.TAIL)
		.map(e => e.target);

const collectRefs = (id: NodeId, guarded: boolean, fields: ReadonlyMap<NodeId, string>, g: Graph, seen: Set<NodeId>): ReadonlyArray<Ref> => {
	if (seen.has(id)) {
		return [];
	}
	seen.add(id);
	const node = Nodes.get(id)(g);

	if (node === undefined) {
		return [];
	}

	if (node.tag === Tags.VAR_LABEL) {
		const target = Edges.one(id, Labels.REFERS_TO)(g)?.target;
		const to = target !== undefined ? fields.get(target) : undefined;
		return to !== undefined ? [{ to, guarded }] : [];
	}
	const next = guarded || node.tag === Tags.LAMBDA;
	return structuralChildren(id, g).flatMap(c => collectRefs(c, next, fields, g, seen));
};

const adjacency = (edges: ReadonlyArray<Edge>): ReadonlyMap<string, ReadonlyArray<string>> =>
	edges.reduce<Map<string, string[]>>((m, e) => m.set(e.from, [...(m.get(e.from) ?? []), e.to]), new Map());

const hasCycle = (graph: ReadonlyMap<string, ReadonlyArray<string>>): boolean => {
	const visiting = new Set<string>();
	const done = new Set<string>();
	const dfs = (n: string): boolean => {
		if (visiting.has(n)) {
			return true;
		}

		if (done.has(n)) {
			return false;
		}
		visiting.add(n);
		const found = (graph.get(n) ?? []).some(dfs);
		visiting.delete(n);
		done.add(n);
		return found;
	};
	return [...graph.keys()].some(dfs);
};

const flagStruct = (s: NodeId, g: Graph): Graph => {
	const fieldEdges = Edges.byLabel(s, Labels.FIELD)(g);
	const fields = new Map(fieldEdges.map(e => [e.target, String(e.payload.label ?? "")] as const));
	const edges = fieldEdges.flatMap(e =>
		collectRefs(e.target, false, fields, g, new Set<NodeId>()).map((r): Edge => ({ from: String(e.payload.label ?? ""), to: r.to, guarded: r.guarded })),
	);

	// A cycle made only of eager references (value-level codata / ill-founded) has no
	// construction order. A lambda-guarded cycle is a recursive function — admitted, tied by
	// the knot pass. Only the eager case is rejected.
	if (hasCycle(adjacency(edges.filter(e => !e.guarded)))) {
		throw new Error(
			"GRAM label-cycles: eager cyclic field reference (value-level codata / ill-founded) has no construction order — guard the cycle behind a function",
		);
	}
	return g;
};

export const flagCycles: Pass = (g: Graph): Graph => [...Query.byTag(Tags.STRUCT)(g)].reduce((acc, s) => flagStruct(s, acc), g);

export const descriptor: Descriptor = {
	name: "label-cycles",
	requires: { tags: new Set([Tags.STRUCT, Tags.VAR_LABEL, Tags.LAMBDA]), labels: new Set([Labels.FIELD, Labels.REFERS_TO]) },
	delta: { tags: none, labels: none },
	run: flagCycles,
};
