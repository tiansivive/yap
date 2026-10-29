import { Edges } from "../graph";
import type { Graph } from "../graph";
import { Tags, Labels } from "../vocabulary";
import type { Pass } from "../grs/strategy";
import type { Rule } from "../grs/rule";
import * as Strategy from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";
import { none } from "../pipeline/descriptor";

// A struct field whose closure captures the struct itself gets a :backpatch edge from the struct,
// alongside its :field edge. The bridge then allocates the struct first and fills that field in
// afterwards, once the closure has the struct to capture.

const lhsNodes = [
	{ bind: "$closure", tag: Tags.CLOSURE },
	{ bind: "$lambda", tag: Tags.LAMBDA },
	{ bind: "$env", tag: Tags.ENV },
	{ bind: "$struct", tag: Tags.STRUCT },
] as const;

const rhsNodes = [{ bind: "$closure" }, { bind: "$lambda" }, { bind: "$env" }, { bind: "$struct" }] as const;

const anchor: Rule = {
	lhs: {
		nodes: lhsNodes,
		edges: [
			{ source: "$closure", label: Labels.BODY, target: "$lambda" },
			{ source: "$closure", label: Labels.ENV, target: "$env" },
			{ source: "$env", label: Labels.CAPTURE, target: "$struct" },
		],
	},
	rhs: { nodes: [], edges: [] },
	where: (bindings, g) => {
		const lambda = bindings.get("$lambda");
		const struct = bindings.get("$struct");
		return (
			lambda !== undefined &&
			struct !== undefined &&
			Edges.byLabel(struct, Labels.FIELD)(g).some(e => e.target === lambda) &&
			!Edges.byLabel(struct, Labels.BACKPATCH)(g).some(e => e.target === lambda)
		);
	},
};

const rule = (bindings: ReadonlyMap<string, number>, g: Graph): Rule => {
	const closure = bindings.get("$closure") ?? -1;
	const lambda = bindings.get("$lambda") ?? -1;
	const env = bindings.get("$env") ?? -1;
	const struct = bindings.get("$struct") ?? -1;
	const body = Edges.one(closure, Labels.BODY)(g);
	const environment = Edges.one(closure, Labels.ENV)(g);
	const capture = Edges.byLabel(env, Labels.CAPTURE)(g).find(e => e.target === struct);
	const field = Edges.byLabel(struct, Labels.FIELD)(g).find(e => e.target === lambda);
	const preserved = [
		body === undefined ? [] : [{ source: "$closure", label: Labels.BODY, target: "$lambda", payload: body.payload }],
		environment === undefined ? [] : [{ source: "$closure", label: Labels.ENV, target: "$env", payload: environment.payload }],
		capture === undefined ? [] : [{ source: "$env", label: Labels.CAPTURE, target: "$struct", payload: capture.payload }],
		field === undefined ? [] : [{ source: "$struct", label: Labels.FIELD, target: "$lambda", payload: field.payload }],
	].flat();

	return {
		lhs: { nodes: lhsNodes, edges: preserved },
		rhs: {
			nodes: rhsNodes,
			edges: [...preserved, { source: "$struct", label: Labels.BACKPATCH, target: "$lambda" }],
		},
	};
};

export const knot: Pass = Strategy.derive(anchor, rule);

export const descriptor: Descriptor = {
	name: "knot",
	requires: { tags: new Set([Tags.STRUCT, Tags.CLOSURE, Tags.LAMBDA, Tags.ENV]), labels: new Set([Labels.FIELD, Labels.ENV, Labels.CAPTURE]) },
	delta: { tags: none, labels: { added: new Set([Labels.BACKPATCH]), removed: new Set() } },
	run: knot,
};
