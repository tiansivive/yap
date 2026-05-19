import { Nodes, Edges, Query } from "../graph";
import type { Graph, NodeId } from "../graph";
import { Tags, Labels, isStructural } from "../vocabulary";
import * as P from "../payload";
import type { Rule } from "../grs";
import * as Strategy from "../grs/strategy";
import * as Rewrite from "../grs/rewrite";
import type { Descriptor } from "../pipeline/descriptor";
import { none } from "../pipeline/descriptor";

export const rule: Rule = {
	lhs: {
		nodes: [{ bind: "$lam", tag: Tags.LAMBDA }, { bind: "$app", tag: Tags.APP }, { bind: "$arg", tag: Tags.VAR_BOUND }, { bind: "$f" }],
		edges: [
			{ source: "$lam", label: Labels.BODY, target: "$app" },
			{ source: "$app", label: Labels.FUNC, target: "$f" },
			{ source: "$app", label: Labels.ARG, target: "$arg" },
			{ source: "$arg", label: Labels.REFERS_TO, target: "$lam" },
		],
	},
	rhs: {
		nodes: [{ bind: "$f" }],
		edges: [],
	},
	redirect: { $lam: "$f" },
	where: (b, g) => {
		const fId = b.get("$f") ?? -1;
		const lamId = b.get("$lam") ?? -1;
		return !Query.any(
			fId,
			e => e.label === Labels.REFERS_TO && e.target === lamId,
			e => isStructural(e.label),
		)(g);
	},
};

const BINDER_TAGS: ReadonlySet<string> = new Set([Tags.LAMBDA, Tags.PI, Tags.SIGMA, Tags.MU, Tags.LET, Tags.STMT_LET]);

const isBinder = (id: NodeId, g: Graph): boolean => {
	const tag = Nodes.get(id)(g)?.tag;
	return tag !== undefined && BINDER_TAGS.has(tag);
};

// Redirect leaves orphaned :scope edges on non-binder targets after lambda removal
const cleanup = (g: Graph): Graph => {
	const bounds = Query.byTag(Tags.VAR_BOUND)(g);
	return [...bounds].reduce<Graph>((acc, varId) => {
		const scopes = Edges.byLabel(varId, Labels.SCOPE)(acc);
		const orphaned = scopes.filter(e => !isBinder(e.target, acc));
		return orphaned.reduce<Graph>((a, edge) => {
			const a2 = Edges.remove(edge)(a);
			const node = Nodes.get(varId)(a2);

			if (node === undefined) {
				return a2;
			}
			const idx = P.number(node.payload, "index");
			return idx > 0 ? Nodes.retag(varId, Tags.VAR_BOUND, { ...node.payload, index: idx - 1 }, node.provenance)(a2) : a2;
		}, acc);
	}, g);
};

const step = (g: Graph): Graph | undefined => {
	const result = Rewrite.apply(rule, g);
	return result !== undefined ? cleanup(result) : undefined;
};

export const eta: Strategy.Pass = (g: Graph): Graph => {
	const next = step(g);
	return next !== undefined ? eta(next) : g;
};

export const descriptor: Descriptor = {
	name: "eta",
	requires: {
		tags: new Set([Tags.LAMBDA, Tags.APP, Tags.VAR_BOUND]),
		labels: new Set([Labels.BODY, Labels.FUNC, Labels.ARG, Labels.REFERS_TO]),
	},
	delta: { tags: none, labels: none },
	run: eta,
};
