import { match } from "ts-pattern";

import { Nodes, Edges, entry } from "../graph";
import type { Graph, NodeId } from "../graph";
import { Tags, Labels, isStructural } from "../vocabulary";
import type { Pass } from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";
import { none } from "../pipeline/descriptor";

// Resolve label references the way bound variables resolve. The descent carries a scope stack
// of label frames (a struct's :field edges, a sigma binder's variable) interleaved with the
// lambdas crossed to reach them. For each `:label` reference:
//   - :refers_to → the field it names (nearest enclosing frame, innermost shadows);
//   - :scope → each lambda pushed after that frame, i.e. the lambdas the reference escapes.
// A lambda above the resolved frame is a boundary the closure must capture across; one below
// it (the target is local to the lambda) is not, and gets no :scope edge.
// A `$label` reference already has its :scope edges from translation, and the one marked `owner`
// points at its record. Here it only gains :refers_to, to the field of that record it names.

type Frame = ReadonlyMap<string, NodeId>;
type Scope = { readonly kind: "frame"; readonly frame: Frame } | { readonly kind: "lambda"; readonly lam: NodeId };

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const children = (id: NodeId, g: Graph): ReadonlyArray<NodeId> =>
	Edges.outgoing(id)(g)
		.filter(e => isStructural(e.label) || e.label === Labels.TAIL)
		.map(e => e.target);

const frameOf = (id: NodeId, g: Graph): Scope => ({
	kind: "frame",
	frame: new Map(Edges.byLabel(id, Labels.FIELD)(g).map(e => [str(e.payload.label), e.target])),
});

// Nearest enclosing frame binding `name`, plus the lambdas crossed to reach it.
const find = (scopes: ReadonlyArray<Scope>, name: string): { readonly target?: NodeId; readonly lambdas: ReadonlyArray<NodeId> } =>
	scopes.reduceRight<{ target?: NodeId; lambdas: ReadonlyArray<NodeId> }>(
		(acc, s) =>
			acc.target !== undefined
				? acc
				: match(s)
						.with({ kind: "lambda" }, ({ lam }) => ({ target: acc.target, lambdas: [...acc.lambdas, lam] }))
						.with({ kind: "frame" }, ({ frame }) => {
							const t = frame.get(name);
							return t !== undefined ? { target: t, lambdas: acc.lambdas } : acc;
						})
						.exhaustive(),
		{ lambdas: [] },
	);

const descend = (ids: ReadonlyArray<NodeId>, scopes: ReadonlyArray<Scope>, g: Graph): Graph => ids.reduce((acc, c) => walk(c, scopes, acc), g);

const resolve = (id: NodeId, name: string, scopes: ReadonlyArray<Scope>, g: Graph): Graph => {
	const { target, lambdas } = find(scopes, name);

	if (target === undefined) {
		return g;
	}
	const g1 = Edges.add(id, Labels.REFERS_TO, target)(g);
	return lambdas.reduce((acc, lam, i) => Edges.add(id, Labels.SCOPE, lam, { level: i })(acc), g1);
};

const nu = (id: NodeId, name: string, g: Graph): Graph => {
	const owner = Edges.byLabel(id, Labels.SCOPE)(g).find(e => e.payload.owner === true)?.target;
	const body = owner !== undefined ? Edges.one(owner, Labels.BODY)(g)?.target : undefined;
	const field = body !== undefined ? Edges.byLabel(body, Labels.FIELD)(g).find(e => e.payload.label === name) : undefined;
	return field !== undefined ? Edges.add(id, Labels.REFERS_TO, field.target)(g) : g;
};

const sigma = (id: NodeId, scopes: ReadonlyArray<Scope>, g: Graph): Graph => {
	const ann = Edges.one(id, Labels.ANNOTATION)(g)?.target;
	const body = Edges.one(id, Labels.BODY)(g)?.target;
	const variable = str(Nodes.get(id)(g)?.payload.variable);
	const g1 = ann !== undefined ? walk(ann, scopes, g) : g;
	const inner: Scope = { kind: "frame", frame: new Map([[variable, id]]) };
	return body !== undefined ? walk(body, [...scopes, inner], g1) : g1;
};

const lambda = (id: NodeId, scopes: ReadonlyArray<Scope>, g: Graph): Graph => {
	const ann = Edges.one(id, Labels.ANNOTATION)(g)?.target;
	const body = Edges.one(id, Labels.BODY)(g)?.target;
	const g1 = ann !== undefined ? walk(ann, scopes, g) : g;
	return body !== undefined ? walk(body, [...scopes, { kind: "lambda", lam: id }], g1) : g1;
};

// Structural edges form a tree, so the descent needs no visited guard.
const walk = (id: NodeId, scopes: ReadonlyArray<Scope>, g: Graph): Graph => {
	const node = Nodes.get(id)(g);

	if (node === undefined) {
		return g;
	}
	return match(node.tag)
		.with(Tags.VAR_LABEL, () => resolve(id, str(node.payload.name), scopes, g))
		.with(Tags.VAR_NU_LABEL, () => nu(id, str(node.payload.name), g))
		.with(Tags.STRUCT, () => descend(children(id, g), [...scopes, frameOf(id, g)], g))
		.with(Tags.SIGMA, () => sigma(id, scopes, g))
		.with(Tags.LAMBDA, () => lambda(id, scopes, g))
		.otherwise(() => descend(children(id, g), scopes, g));
};

export const resolveLabels: Pass = (g: Graph): Graph => {
	const root = entry(g);
	return root !== undefined ? walk(root, [], g) : g;
};

export const descriptor: Descriptor = {
	name: "resolve-labels",
	requires: {
		tags: new Set([Tags.STRUCT, Tags.SIGMA, Tags.NU, Tags.VAR_LABEL, Tags.VAR_NU_LABEL, Tags.LAMBDA]),
		labels: new Set([Labels.FIELD, Labels.SCOPE]),
	},
	delta: { tags: none, labels: none },
	run: resolveLabels,
};
