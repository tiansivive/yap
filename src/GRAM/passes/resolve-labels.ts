import { match } from "ts-pattern";

import { Nodes, Edges, entry } from "../graph";
import type { Graph, NodeId } from "../graph";
import { Tags, Labels, isStructural } from "../vocabulary";
import type { Pass } from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";
import { none } from "../pipeline/descriptor";

// Resolve `:label` references the way bound variables resolve. The descent carries a scope
// stack of label frames (a struct's :field edges, a sigma binder's variable) interleaved with
// the lambdas crossed to reach them. For each `var:label`:
//   - :refers_to → the field it names (nearest enclosing frame, innermost shadows);
//   - :scope → each lambda pushed after that frame, i.e. the lambdas the reference escapes.
// A lambda above the resolved frame is a boundary the closure must capture across; one below
// it (the target is local to the lambda) is not, and gets no :scope edge.

type Frame = ReadonlyMap<string, NodeId>;
type Scope = { readonly kind: "frame"; readonly frame: Frame } | { readonly kind: "lambda"; readonly lam: NodeId };

const children = (id: NodeId, g: Graph): ReadonlyArray<NodeId> =>
	Edges.outgoing(id)(g)
		.filter(e => isStructural(e.label) || e.label === Labels.TAIL)
		.map(e => e.target);

const frameOf = (id: NodeId, g: Graph): Scope => ({
	kind: "frame",
	frame: new Map(Edges.byLabel(id, Labels.FIELD)(g).map(e => [String(e.payload.label ?? ""), e.target])),
});

// Nearest enclosing frame binding `name`, plus the lambdas crossed to reach it.
const find = (scopes: ReadonlyArray<Scope>, name: string): { readonly target?: NodeId; readonly lambdas: ReadonlyArray<NodeId> } =>
	scopes.reduceRight<{ target?: NodeId; lambdas: ReadonlyArray<NodeId> }>(
		(acc, s) => {
			if (acc.target !== undefined) {
				return acc;
			}

			if (s.kind === "lambda") {
				return { target: acc.target, lambdas: [...acc.lambdas, s.lam] };
			}
			const t = s.frame.get(name);
			return t !== undefined ? { target: t, lambdas: acc.lambdas } : acc;
		},
		{ lambdas: [] },
	);

const descend = (ids: ReadonlyArray<NodeId>, scopes: ReadonlyArray<Scope>, g: Graph, seen: Set<NodeId>): Graph =>
	ids.reduce((acc, c) => walk(c, scopes, acc, seen), g);

const resolve = (id: NodeId, name: string, scopes: ReadonlyArray<Scope>, g: Graph): Graph => {
	const { target, lambdas } = find(scopes, name);

	if (target === undefined) {
		return g;
	}
	const g1 = Edges.add(id, Labels.REFERS_TO, target)(g);
	return lambdas.reduce((acc, lam, i) => Edges.add(id, Labels.SCOPE, lam, { level: i })(acc), g1);
};

const sigma = (id: NodeId, scopes: ReadonlyArray<Scope>, g: Graph, seen: Set<NodeId>): Graph => {
	const ann = Edges.one(id, Labels.ANNOTATION)(g)?.target;
	const body = Edges.one(id, Labels.BODY)(g)?.target;
	const variable = String(Nodes.get(id)(g)?.payload.variable ?? "");
	const g1 = ann !== undefined ? walk(ann, scopes, g, seen) : g;
	const inner: Scope = { kind: "frame", frame: new Map([[variable, id]]) };
	return body !== undefined ? walk(body, [...scopes, inner], g1, seen) : g1;
};

const lambda = (id: NodeId, scopes: ReadonlyArray<Scope>, g: Graph, seen: Set<NodeId>): Graph => {
	const ann = Edges.one(id, Labels.ANNOTATION)(g)?.target;
	const body = Edges.one(id, Labels.BODY)(g)?.target;
	const g1 = ann !== undefined ? walk(ann, scopes, g, seen) : g;
	return body !== undefined ? walk(body, [...scopes, { kind: "lambda", lam: id }], g1, seen) : g1;
};

const walk = (id: NodeId, scopes: ReadonlyArray<Scope>, g: Graph, seen: Set<NodeId>): Graph => {
	if (seen.has(id)) {
		return g;
	}
	seen.add(id);
	const node = Nodes.get(id)(g);

	if (node === undefined) {
		return g;
	}
	return match(node.tag)
		.with(Tags.VAR_LABEL, () => resolve(id, String(node.payload.name ?? ""), scopes, g))
		.with(Tags.STRUCT, () => descend(children(id, g), [...scopes, frameOf(id, g)], g, seen))
		.with(Tags.SIGMA, () => sigma(id, scopes, g, seen))
		.with(Tags.LAMBDA, () => lambda(id, scopes, g, seen))
		.otherwise(() => descend(children(id, g), scopes, g, seen));
};

export const resolveLabels: Pass = (g: Graph): Graph => {
	const root = entry(g);
	return root !== undefined ? walk(root, [], g, new Set<NodeId>()) : g;
};

export const descriptor: Descriptor = {
	name: "resolve-labels",
	requires: { tags: new Set([Tags.STRUCT, Tags.SIGMA, Tags.VAR_LABEL, Tags.LAMBDA]), labels: new Set([Labels.FIELD]) },
	delta: { tags: none, labels: none },
	run: resolveLabels,
};
