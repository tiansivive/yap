import { match } from "ts-pattern";

import { Nodes, Edges, Query } from "../graph";
import type { Graph, NodeId } from "../graph";
import { Tags, Labels, isStructural } from "../vocabulary";
import * as P from "../payload";
import type { Pass } from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";

const PASS = { created_by: "shift-reset" } as const;

const findShift = (resetId: NodeId, g: Graph): NodeId | undefined => {
	const body = Query.follow(resetId, Labels.BODY)(g);

	if (body === undefined) {
		return undefined;
	}
	return match(Nodes.get(body)(g)?.tag)
		.with(Tags.SHIFT, () => body)
		.otherwise(
			() =>
				Query.collect(
					body,
					e => Nodes.get(e.target)(g)?.tag === Tags.SHIFT,
					e => isStructural(e.label),
				)(g)[0]?.target,
		);
};

const isVarBound = (id: NodeId, g: Graph): boolean =>
	match(Nodes.get(id)(g)?.tag)
		.with(Tags.VAR_BOUND, () => true)
		.otherwise(() => false);

const isApp = (id: NodeId, g: Graph): boolean =>
	match(Nodes.get(id)(g)?.tag)
		.with(Tags.APP, () => true)
		.otherwise(() => false);

const findKCalls = (lambdaId: NodeId, g: Graph): ReadonlyArray<NodeId> =>
	Edges.to(lambdaId)(g)
		.filter(e => e.label === Labels.REFERS_TO && isVarBound(e.source, g))
		.flatMap(e =>
			Edges.to(e.source)(g)
				.filter(fe => fe.label === Labels.FUNC)
				.map(fe => fe.source),
		)
		.filter(id => isApp(id, g));

const binderName = (shiftId: NodeId, g: Graph, index: number): string => {
	const letParent = Edges.to(shiftId)(g).find(
		e =>
			e.label === Labels.VALUE &&
			match(Nodes.get(e.source)(g)?.tag)
				.with(Tags.STMT_LET, () => true)
				.otherwise(() => false),
	);

	if (letParent === undefined) {
		return `$bubble_${index}`;
	}
	const node = Nodes.get(letParent.source)(g);

	if (node === undefined) {
		return `$bubble_${index}`;
	}
	return P.string(node.payload, "variable");
};

const redirect = (from: NodeId, to: NodeId, g: Graph): Graph =>
	Edges.to(from)(g).reduce((acc, e) => Edges.add(e.source, e.label, to, e.payload)(Edges.remove(e)(acc)), g);

const bubble = (shiftId: NodeId, binder: string, g: Graph): [NodeId, Graph] => {
	const [bubbleId, g1] = Nodes.add(Tags.BUBBLE, { binder }, PASS)(g);
	return [bubbleId, redirect(shiftId, bubbleId, g1)];
};

const detachBody = (shiftId: NodeId, g: Graph): Graph => {
	const edge = Edges.one(shiftId, Labels.BODY)(g);
	return edge !== undefined ? Edges.remove(edge)(g) : g;
};

const continuation = (resetId: NodeId, shiftId: NodeId, lambdaId: NodeId, bubbleId: NodeId, binder: string, g: Graph): [NodeId, Graph] => {
	const [contId, g1] = Nodes.add(Tags.CONTINUATION, { binder }, PASS)(g);
	const g2 = [
		Edges.add(contId, Labels.DELIMITER, resetId),
		Edges.add(contId, Labels.CAPTURED_AT, shiftId),
		Edges.add(contId, Labels.HANDLER, lambdaId),
		Edges.add(contId, Labels.PARAM, bubbleId),
	].reduce((acc, op) => op(acc), g1);
	return [contId, g2];
};

const wireResumptions = (kcalls: ReadonlyArray<NodeId>, contId: NodeId, g: Graph): Graph =>
	kcalls.reduce((acc, appId) => {
		const funcEdge = Edges.one(appId, Labels.FUNC)(acc);
		const cleared = funcEdge !== undefined ? Edges.remove(funcEdge)(acc) : acc;
		const retagged = Nodes.retag(appId, Tags.RESUMPTION, Nodes.get(appId)(acc)?.payload ?? {}, PASS)(cleared);
		return Edges.add(appId, Labels.INVOKES, contId)(retagged);
	}, g);

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
	const [bubbleId, g1] = bubble(shiftId, binder, g);
	const g2 = detachBody(shiftId, g1);
	const [contId, g3] = continuation(resetId, shiftId, lambdaId, bubbleId, binder, g2);
	return wireResumptions(kcalls, contId, g3);
};

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
