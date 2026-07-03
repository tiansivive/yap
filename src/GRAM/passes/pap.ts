import { Nodes, Edges, Query } from "../graph";
import type { Graph } from "../graph";
import { Tags, Labels } from "../vocabulary";
import * as P from "../payload";
import type { Rule } from "../grs";
import * as Strategy from "../grs/strategy";
import type { Pass } from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";

const PASS = { created_by: "pap" } as const;

// DPO rule: match unsaturated EXTERNAL, add PAP node with :materializes edge
const papRule: Rule = {
	lhs: {
		nodes: [{ bind: "$ext", tag: Tags.EXTERNAL, payload: p => p.saturated === false }],
		edges: [],
	},
	rhs: {
		nodes: [
			{ bind: "$ext" },
			{
				bind: "$pap",
				tag: Tags.PAP,
				payload: (b, host) => {
					const extId = b.get("$ext") ?? -1;
					const node = Nodes.get(extId)(host);

					if (node === undefined) {
						return { remaining: 0 };
					}
					const arity = P.number(node.payload, "arity");
					const args = P.number(node.payload, "args");
					return { remaining: arity - args };
				},
				provenance: PASS,
			},
		],
		edges: [{ source: "$pap", label: Labels.MATERIALIZES, target: "$ext" }],
	},
	where: (b, host) => {
		const extId = b.get("$ext");

		if (extId === undefined) {
			return false;
		}
		const alreadyHasPap = Edges.to(extId)(host).some(e => e.label === Labels.MATERIALIZES && Nodes.get(e.source)(host)?.tag === Tags.PAP);
		return !alreadyHasPap;
	},
};

// GRS cannot express variable-length edge copying (aggregate patterns).
// Imperative pass wires :captured edges from PAP to EXTERNAL's :arg targets.
const wireCaptures: Pass = (g: Graph): Graph =>
	[...Query.byTag(Tags.PAP)(g)].reduce((acc, papId) => {
		const matEdge = Edges.one(papId, Labels.MATERIALIZES)(acc);

		if (matEdge === undefined) {
			return acc;
		}

		const extId = matEdge.target;
		const argEdges = Edges.byLabel(
			extId,
			Labels.ARG,
		)(acc)
			.slice()
			.sort((a, b) => P.number(a.payload, "index") - P.number(b.payload, "index"));

		return argEdges.reduce((a, edge) => Edges.add(papId, Labels.CAPTURED, edge.target, { index: edge.payload.index })(a), acc);
	}, g);

export const pap: Pass = Strategy.seq(Strategy.apply(papRule), wireCaptures);

export const descriptor: Descriptor = {
	name: "pap",
	requires: {
		tags: new Set([Tags.EXTERNAL]),
		labels: new Set([Labels.ARG]),
	},
	delta: {
		tags: { added: new Set([Tags.PAP]), removed: new Set() },
		labels: { added: new Set([Labels.MATERIALIZES, Labels.CAPTURED]), removed: new Set() },
	},
	run: pap,
};
