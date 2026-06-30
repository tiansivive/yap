import { match } from "ts-pattern";

import { Nodes, Edges, Query } from "../graph";
import type { Graph, NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import type { Pass } from "../grs/strategy";
import type { Rule } from "../grs/rule";
import * as Strategy from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";

const PASS_CAPTURE = { created_by: "capture" } as const;

// GRS cannot express aggregate pattern matching (variable-length captured set).
// LoGRAM (Datalog over triple store) will make this a first-class join.
const GLOBAL_TAGS: ReadonlySet<string> = new Set([Tags.VAR_FREE, Tags.VAR_FOREIGN]);

const isGlobal = (id: NodeId, g: Graph): boolean => GLOBAL_TAGS.has(Nodes.get(id)(g)?.tag ?? "");

const level = (id: NodeId, g: Graph): number => Number(Nodes.get(id)(g)?.payload.level ?? 0);

const isCapture =
	(lamId: NodeId, lamLvl: number, g: Graph) =>
	(e: { target: NodeId }): boolean =>
		e.target !== lamId && (isGlobal(e.target, g) || level(e.target, g) < lamLvl);

// The struct that owns a field value — reverse the :field edge.
const structOf = (target: NodeId, g: Graph): NodeId | undefined => Edges.to(target)(g).find(e => e.label === Labels.FIELD)?.source;

const capturesOf = (lamId: NodeId, g: Graph): ReadonlyArray<NodeId> => {
	const lamLvl = level(lamId, g);
	const targets = Edges.to(lamId)(g)
		.filter(e => e.label === Labels.SCOPE)
		.flatMap(e => {
			const ref = Edges.one(e.source, Labels.REFERS_TO)(g);

			if (ref === undefined) {
				return [];
			}

			// A label crossing this lambda captures the whole record (the struct owning the
			// referenced field), so the label reads its field off the captured record. The
			// de Bruijn level filter applies only to bound-variable captures.
			if (Nodes.get(e.source)(g)?.tag === Tags.VAR_LABEL) {
				const s = structOf(ref.target, g);
				return s !== undefined ? [s] : [];
			}
			return isCapture(lamId, lamLvl, g)(ref) ? [ref.target] : [];
		});
	return [...new Set(targets)];
};

const isOpen = (lamId: NodeId, g: Graph): boolean => Edges.one(lamId, Labels.ENV)(g) === undefined;

const enrichOne = (lamId: NodeId, g: Graph): Graph => {
	const caps = capturesOf(lamId, g);
	const [envId, g1] = Nodes.add(Tags.ENV, {}, PASS_CAPTURE)(g);
	const g2 = Edges.add(lamId, Labels.ENV, envId)(g1);
	return caps.reduce((acc, capId, i) => Edges.add(envId, Labels.CAPTURE, capId, { index: i })(acc), g2);
};

export const capture: Pass = (g: Graph): Graph => {
	const lambdas = [...Query.byTag(Tags.LAMBDA)(g)].filter(id => isOpen(id, g));
	return lambdas.reduce((acc, id) => enrichOne(id, acc), g);
};

// Additive — backends query the closure node; structural passes ignore it.
export const closeRule: Rule = {
	lhs: {
		nodes: [{ bind: "$lam", tag: Tags.LAMBDA }, { bind: "$env" }],
		edges: [{ source: "$lam", label: Labels.ENV, target: "$env" }],
	},
	rhs: {
		nodes: [{ bind: "$lam" }, { bind: "$env" }, { bind: "$closure", tag: Tags.CLOSURE, provenance: { created_by: "close" } }],
		edges: [
			{ source: "$lam", label: Labels.ENV, target: "$env" },
			{ source: "$closure", label: Labels.BODY, target: "$lam" },
			{ source: "$closure", label: Labels.ENV, target: "$env" },
		],
	},
	where: (b, g) => {
		const lamId = b.get("$lam");

		if (lamId === undefined) {
			return false;
		}
		const alreadyClosed = Edges.to(lamId)(g).some(
			e =>
				e.label === Labels.BODY &&
				match(Nodes.get(e.source)(g)?.tag)
					.with(Tags.CLOSURE, () => true)
					.otherwise(() => false),
		);
		return !alreadyClosed;
	},
};

export const close: Pass = Strategy.apply(closeRule);

export const closureConvert: Pass = (g: Graph): Graph => close(capture(g));

export const descriptor: Descriptor = {
	name: "closure",
	requires: {
		tags: new Set([Tags.LAMBDA, Tags.VAR_BOUND, Tags.VAR_REF]),
		labels: new Set([Labels.SCOPE, Labels.REFERS_TO]),
	},
	delta: {
		tags: { added: new Set([Tags.CLOSURE, Tags.ENV]), removed: new Set() },
		labels: {
			added: new Set([Labels.ENV, Labels.CAPTURE]),
			removed: new Set(),
		},
	},
	run: closureConvert,
};
