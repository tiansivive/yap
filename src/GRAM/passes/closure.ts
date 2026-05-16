import { Nodes, Edges, Query } from "../graph";
import type { Graph, NodeId } from "../graph";
import { Tags, Labels } from "../vocabulary";
import type { Pass } from "../grs/strategy";

const PASS_CAPTURE = { created_by: "capture" } as const;
const PASS_CLOSE = { created_by: "close" } as const;

// ── Capture: add env with :capture edges to each lambda ──

const GLOBAL_TAGS: ReadonlySet<string> = new Set([Tags.VAR_FREE, Tags.VAR_FOREIGN]);

const isGlobal = (id: NodeId, g: Graph): boolean => GLOBAL_TAGS.has(Nodes.get(id)(g)?.tag ?? "");

const level = (id: NodeId, g: Graph): number => Number(Nodes.get(id)(g)?.payload.level ?? 0);

const capturesOf = (lamId: NodeId, g: Graph): ReadonlyArray<NodeId> => {
	const lamLvl = level(lamId, g);
	const scoped = Edges.to(lamId)(g).filter(e => e.label === Labels.SCOPE);
	const targets = scoped
		.map(e => Edges.one(e.source, Labels.REFERS_TO)(g))
		.filter((e): e is NonNullable<typeof e> => e !== undefined && e.target !== lamId && (isGlobal(e.target, g) || level(e.target, g) < lamLvl))
		.map(e => e.target);
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

// ── Close: add closure node wrapping each lambda + env ──
// NOTE: the closure node is additive — it doesn't replace the lambda or
// change any existing edges. It enriches the graph with a first-class
// entity linking lambda and env. Backends query it; structural passes
// ignore it. The final compiler may omit this node if :env on the lambda
// proves sufficient.

const hasClosure = (lamId: NodeId, g: Graph): boolean => Edges.to(lamId)(g).some(e => e.label === Labels.BODY && Nodes.get(e.source)(g)?.tag === Tags.CLOSURE);

const closeOne = (lamId: NodeId, g: Graph): Graph => {
	const envEdge = Edges.one(lamId, Labels.ENV)(g);

	if (!envEdge) {
		return g;
	}

	const [closureId, g1] = Nodes.add(Tags.CLOSURE, {}, PASS_CLOSE)(g);
	const g2 = Edges.add(closureId, Labels.BODY, lamId)(g1);
	return Edges.add(closureId, Labels.ENV, envEdge.target)(g2);
};

export const close: Pass = (g: Graph): Graph => {
	const lambdas = [...Query.byTag(Tags.LAMBDA)(g)].filter(id => !hasClosure(id, g));
	return lambdas.reduce((acc, id) => closeOne(id, acc), g);
};

// ── Combined ──

export const closureConvert: Pass = (g: Graph): Graph => close(capture(g));
