import { Edges } from "../graph";
import type { Graph } from "../graph";
import type { Bindings, Rule } from "../grs/rule";
import type { Pass } from "../grs/strategy";
import * as Strategy from "../grs/strategy";
import type { Descriptor } from "../pipeline/descriptor";
import { none } from "../pipeline/descriptor";
import { Labels, Tags } from "../vocabulary";

const lhsNodes = [
	{ bind: "$label", tag: Tags.VAR_NU_LABEL },
	{ bind: "$nu", tag: Tags.NU },
	{ bind: "$struct", tag: Tags.STRUCT },
	{ bind: "$field" },
] as const;

const rhsNodes = [{ bind: "$label" }, { bind: "$nu" }, { bind: "$struct" }, { bind: "$field" }] as const;

const anchor: Rule = {
	lhs: {
		nodes: lhsNodes,
		edges: [
			{ source: "$label", label: Labels.SCOPE, target: "$nu" },
			{ source: "$nu", label: Labels.BODY, target: "$struct" },
			{ source: "$struct", label: Labels.FIELD, target: "$field" },
			{ source: "$label", label: Labels.REFERS_TO, target: "$field" },
		],
	},
	rhs: { nodes: [], edges: [] },
	where: (bindings, g) => {
		const label = bindings.get("$label");
		const nu = bindings.get("$nu");
		const struct = bindings.get("$struct");
		const field = bindings.get("$field");
		return (
			label !== undefined &&
			nu !== undefined &&
			struct !== undefined &&
			field !== undefined &&
			Edges.byLabel(label, Labels.SCOPE)(g).some(e => e.target === nu && e.payload.owner === true) &&
			!Edges.byLabel(struct, Labels.HOIST)(g).some(e => e.target === field)
		);
	},
};

const rule = (bindings: Bindings, g: Graph): Rule => {
	const label = bindings.get("$label") ?? -1;
	const nu = bindings.get("$nu") ?? -1;
	const struct = bindings.get("$struct") ?? -1;
	const field = bindings.get("$field") ?? -1;
	const scope = Edges.byLabel(label, Labels.SCOPE)(g).find(e => e.target === nu);
	const body = Edges.one(nu, Labels.BODY)(g);
	const fieldEdge = Edges.byLabel(struct, Labels.FIELD)(g).find(e => e.target === field);
	const reference = Edges.one(label, Labels.REFERS_TO)(g);
	const preserved = [
		scope === undefined ? [] : [{ source: "$label", label: Labels.SCOPE, target: "$nu", payload: scope.payload }],
		body === undefined ? [] : [{ source: "$nu", label: Labels.BODY, target: "$struct", payload: body.payload }],
		fieldEdge === undefined ? [] : [{ source: "$struct", label: Labels.FIELD, target: "$field", payload: fieldEdge.payload }],
		reference === undefined ? [] : [{ source: "$label", label: Labels.REFERS_TO, target: "$field", payload: reference.payload }],
	].flat();

	return {
		lhs: { nodes: lhsNodes, edges: preserved },
		rhs: {
			nodes: rhsNodes,
			edges: [...preserved, { source: "$struct", label: Labels.HOIST, target: "$field" }],
		},
	};
};

export const hoist: Pass = Strategy.derive(anchor, rule);

export const descriptor: Descriptor = {
	name: "hoist",
	requires: {
		tags: new Set([Tags.NU, Tags.STRUCT, Tags.VAR_NU_LABEL]),
		labels: new Set([Labels.BODY, Labels.FIELD, Labels.REFERS_TO, Labels.SCOPE]),
	},
	delta: { tags: none, labels: { added: new Set([Labels.HOIST]), removed: new Set() } },
	run: hoist,
};
