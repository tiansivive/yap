import { Nodes, Edges, Query } from "../graph";
import type { Graph, NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import type { Pass } from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";
import { none } from "../pipeline/descriptor";

// A struct field whose closure captures the struct cannot be filled at allocation time — the
// record would have to contain a closure that captures the record. The knot pass marks such
// :field edges `backpatch`. The bridge then allocates the record without them, and once the
// capturing closures (which reference the allocated record) are built, fbip-fills the fields.
// This makes the allocate-then-tie knot explicit graph data; the bridge stays a translator.

const capturesStruct = (valueId: NodeId, structId: NodeId, g: Graph): boolean => {
	const closure = Edges.to(valueId)(g).find(e => e.label === Labels.BODY && Nodes.get(e.source)(g)?.tag === Tags.CLOSURE)?.source;
	const env = closure !== undefined ? Edges.one(closure, Labels.ENV)(g)?.target : undefined;
	return env !== undefined && Edges.byLabel(env, Labels.CAPTURE)(g).some(c => c.target === structId);
};

const knotStruct = (s: NodeId, g: Graph): Graph =>
	Edges.byLabel(
		s,
		Labels.FIELD,
	)(g).reduce((acc, e) => {
		if (!capturesStruct(e.target, s, acc)) {
			return acc;
		}
		return Edges.add(s, Labels.FIELD, e.target, { ...e.payload, backpatch: true })(Edges.remove(e)(acc));
	}, g);

export const knot: Pass = (g: Graph): Graph => [...Query.byTag(Tags.STRUCT)(g)].reduce((acc, s) => knotStruct(s, acc), g);

export const descriptor: Descriptor = {
	name: "knot",
	requires: { tags: new Set([Tags.STRUCT, Tags.CLOSURE]), labels: new Set([Labels.FIELD, Labels.ENV, Labels.CAPTURE]) },
	delta: { tags: none, labels: none },
	run: knot,
};
