import { match } from "ts-pattern";

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

// Structural edges form a tree, so the descent needs no visited guard. A reference under a
// lambda is guarded — read at call time; every other node carries the guard inward unchanged.
const collectRefs = (id: NodeId, guarded: boolean, fields: ReadonlyMap<NodeId, string>, g: Graph): ReadonlyArray<Ref> => {
	const node = Nodes.get(id)(g);

	if (node === undefined) {
		return [];
	}
	return match(node.tag)
		.with(Tags.VAR_LABEL, () => {
			const target = Edges.one(id, Labels.REFERS_TO)(g)?.target;
			const to = target !== undefined ? fields.get(target) : undefined;
			return to !== undefined ? [{ to, guarded }] : [];
		})
		.with(Tags.LAMBDA, () => structuralChildren(id, g).flatMap(c => collectRefs(c, true, fields, g)))
		.otherwise(() => structuralChildren(id, g).flatMap(c => collectRefs(c, guarded, fields, g)));
};

const adjacency = (edges: ReadonlyArray<Edge>): ReadonlyMap<string, ReadonlyArray<string>> =>
	edges.reduce<ReadonlyMap<string, ReadonlyArray<string>>>((m, e) => new Map([...m, [e.from, [...(m.get(e.from) ?? []), e.to]]]), new Map());

type Search = { readonly cycle: boolean; readonly done: ReadonlySet<string> };

const hasCycle = (graph: ReadonlyMap<string, ReadonlyArray<string>>): boolean =>
	[...graph.keys()].reduce<Search>((acc, k) => (acc.cycle ? acc : visit(k, new Set(), acc.done, graph)), { cycle: false, done: new Set() }).cycle;

// path = nodes on the current DFS stack (a back-edge into it is a cycle); done = fully explored.
const visit = (node: string, path: ReadonlySet<string>, done: ReadonlySet<string>, graph: ReadonlyMap<string, ReadonlyArray<string>>): Search => {
	if (path.has(node)) {
		return { cycle: true, done };
	}

	if (done.has(node)) {
		return { cycle: false, done };
	}
	const next = new Set([...path, node]);
	const result = (graph.get(node) ?? []).reduce<Search>((acc, n) => (acc.cycle ? acc : visit(n, next, acc.done, graph)), { cycle: false, done });
	return { cycle: result.cycle, done: new Set([...result.done, node]) };
};

const flagStruct = (s: NodeId, g: Graph): Graph => {
	const fieldEdges = Edges.byLabel(s, Labels.FIELD)(g);
	const fields = new Map(fieldEdges.map(e => [e.target, String(e.payload.label ?? "")] as const));
	const edges = fieldEdges.flatMap(e =>
		collectRefs(e.target, false, fields, g).map((r): Edge => ({ from: String(e.payload.label ?? ""), to: r.to, guarded: r.guarded })),
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
