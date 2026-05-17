import { Nodes, Edges, Query } from "../graph";
import type { Graph, NodeId } from "../graph";
import { Tags, Labels, isStructural } from "../vocabulary";
import type { Pass } from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";
import { none } from "../pipeline/descriptor";

const PASS = { created_by: "shift-reset" } as const;

// ── Helpers ──

const findShift = (resetId: NodeId, g: Graph): NodeId | undefined => {
	const body = Query.follow(resetId, Labels.BODY)(g);

	if (body === undefined) {
		return undefined;
	}

	if (Nodes.get(body)(g)?.tag === Tags.SHIFT) {
		return body;
	}

	const collected = Query.collect(
		body,
		e => Nodes.get(e.target)(g)?.tag === Tags.SHIFT,
		e => isStructural(e.label),
	)(g);

	return collected[0]?.target;
};

const findKCalls = (lambdaId: NodeId, g: Graph): ReadonlyArray<NodeId> => {
	const refs = Edges.to(lambdaId)(g).filter(e => e.label === Labels.REFERS_TO && Nodes.get(e.source)(g)?.tag === Tags.VAR_BOUND);

	return refs
		.flatMap(refEdge => {
			const varId = refEdge.source;
			const funcEdges = Edges.to(varId)(g).filter(e => e.label === Labels.FUNC);
			return funcEdges.map(e => e.source);
		})
		.filter(appId => Nodes.get(appId)(g)?.tag === Tags.APP);
};

const binderName = (shiftId: NodeId, g: Graph, index: number): string => {
	const incoming = Edges.to(shiftId)(g);
	const letParent = incoming.find(e => e.label === Labels.VALUE && Nodes.get(e.source)(g)?.tag === Tags.STMT_LET);
	if (letParent) {
		return (Nodes.get(letParent.source)(g)?.payload.variable as string) ?? `$bubble_${index}`;
	}
	return `$bubble_${index}`;
};

const redirectEdges = (from: NodeId, to: NodeId, g: Graph): Graph =>
	Edges.to(from)(g).reduce((acc, e) => Edges.add(e.source, e.label, to, e.payload)(Edges.remove(e)(acc)), g);

// ── Core: enrich one reset-shift pair ──

const enrichOne = (resetId: NodeId, index: number, g: Graph): Graph => {
	const shiftId = findShift(resetId, g);

	if (shiftId === undefined) {
		return g;
	}

	const lambdaId = Query.follow(shiftId, Labels.BODY)(g);

	if (lambdaId === undefined) {
		return g;
	}

	const binder = binderName(shiftId, g, index);
	const kcalls = findKCalls(lambdaId, g);

	// 1. Create bubble node at the shift's position
	const [bubbleId, g1] = Nodes.add(Tags.BUBBLE, { binder }, PASS)(g);

	// 2. Redirect all edges pointing to shift → bubble
	const g2 = redirectEdges(shiftId, bubbleId, g1);

	// 3. Remove shift -:body-> lambda (moves to continuation :handler)
	const shiftBodyEdge = Edges.one(shiftId, Labels.BODY)(g2);
	const g3 = shiftBodyEdge ? Edges.remove(shiftBodyEdge)(g2) : g2;

	// 4. Create continuation node
	const [contId, g4] = Nodes.add(Tags.CONTINUATION, { binder }, PASS)(g3);
	const g5 = [
		Edges.add(contId, Labels.DELIMITER, resetId),
		Edges.add(contId, Labels.CAPTURED_AT, shiftId),
		Edges.add(contId, Labels.HANDLER, lambdaId),
		Edges.add(contId, Labels.PARAM, bubbleId),
	].reduce((acc, op) => op(acc), g4);

	// 5. Retag kcalls as resumption, rewire edges
	return kcalls.reduce((acc, appId) => {
		const funcEdge = Edges.one(appId, Labels.FUNC)(acc);
		const cleared = funcEdge ? Edges.remove(funcEdge)(acc) : acc;
		const retagged = Nodes.retag(appId, Tags.RESUMPTION, Nodes.get(appId)(acc)?.payload ?? {}, PASS)(cleared);
		return Edges.add(appId, Labels.INVOKES, contId)(retagged);
	}, g5);
};

// ── Pass ──

export const shiftReset: Pass = (g: Graph): Graph => {
	const resets = [...Query.byTag(Tags.RESET)(g)];
	return resets.reduce((acc, id, i) => enrichOne(id, i, acc), g);
};

export const descriptor: Descriptor = {
	name: "shift-reset",
	requires: {
		tags: new Set([Tags.RESET, Tags.SHIFT, Tags.LAMBDA, Tags.APP, Tags.VAR_BOUND]),
		labels: new Set([Labels.BODY, Labels.FUNC, Labels.REFERS_TO]),
	},
	delta: {
		tags: { added: new Set([Tags.BUBBLE, Tags.CONTINUATION, Tags.RESUMPTION]), removed: new Set() },
		labels: {
			added: new Set([Labels.DELIMITER, Labels.CAPTURED_AT, Labels.HANDLER, Labels.PARAM, Labels.INVOKES]),
			removed: new Set(),
		},
	},
	run: shiftReset,
};
