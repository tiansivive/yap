import { Nodes, Edges } from "../graph";
import type { Graph } from "../graph";
import { Tags, Labels } from "../vocabulary";
import * as P from "../payload";
import type { Rule, Bindings } from "../grs";
import * as Strategy from "../grs/strategy";
import { ARITIES } from "../../lowering/shared/primops";
import type { Descriptor } from "../pipeline/descriptor";

const PASS = { created_by: "saturate" } as const;

const initial: Rule = {
	lhs: {
		nodes: [{ bind: "$app", tag: Tags.APP }, { bind: "$ref", tag: Tags.VAR_REF }, { bind: "$foreign", tag: Tags.VAR_FOREIGN }, { bind: "$arg" }],
		edges: [
			{ source: "$app", label: Labels.FUNC, target: "$ref" },
			{ source: "$app", label: Labels.ARG, target: "$arg" },
			{ source: "$ref", label: Labels.REFERS_TO, target: "$foreign" },
		],
	},
	rhs: {
		nodes: [
			{
				bind: "$ext",
				tag: Tags.EXTERNAL,
				payload: (b, host) => {
					const node = Nodes.get(b.get("$foreign") ?? -1)(host);

					if (node === undefined) {
						throw new Error("saturate: $foreign node missing");
					}
					const name = P.string(node.payload, "name");
					const arity = P.number(node.payload, "arity");
					return { name, arity, args: 1, saturated: arity <= 1 };
				},
				provenance: PASS,
			},
			{ bind: "$foreign" },
			{ bind: "$arg" },
		],
		edges: [
			{ source: "$ext", label: ":callee", target: "$foreign" },
			{ source: "$ext", label: Labels.ARG, target: "$arg", payload: { index: 0 } },
		],
	},
	redirect: { $app: "$ext" },
	where: (b, host) => {
		const node = Nodes.get(b.get("$foreign") ?? -1)(host);
		return node?.payload.arity !== undefined;
	},
};

const accumulateAnchor: Rule = {
	lhs: {
		nodes: [{ bind: "$app", tag: Tags.APP }, { bind: "$ext", tag: Tags.EXTERNAL, payload: p => p.saturated !== true }, { bind: "$arg" }],
		edges: [
			{ source: "$app", label: Labels.FUNC, target: "$ext" },
			{ source: "$app", label: Labels.ARG, target: "$arg" },
		],
	},
	rhs: { nodes: [], edges: [] },
};

const buildAccumulate = (b: Bindings, host: Graph): Rule => {
	const extId = b.get("$ext") ?? -1;
	const node = Nodes.get(extId)(host);

	if (node === undefined) {
		throw new Error("saturate: $ext node missing");
	}
	const prev = node.payload;
	const args = P.number(prev, "args");
	const arity = P.number(prev, "arity");

	return {
		lhs: accumulateAnchor.lhs,
		rhs: {
			nodes: [
				{
					bind: "$ext",
					tag: Tags.EXTERNAL,
					payload: { ...prev, args: args + 1, saturated: args + 1 >= arity },
					provenance: PASS,
				},
				{ bind: "$arg" },
			],
			edges: [{ source: "$ext", label: Labels.ARG, target: "$arg", payload: { index: args } }],
		},
		redirect: { $app: "$ext" },
	};
};

const sortByIndex = <T extends { payload: Record<string, unknown> }>(edges: ReadonlyArray<T>): T[] =>
	edges.slice().sort((a, b) => Number(a.payload.index ?? 0) - Number(b.payload.index ?? 0));

const chainArgs: Strategy.Pass = (g: Graph): Graph => {
	const externals = [...(g.byTag.get(Tags.EXTERNAL) ?? []), ...(g.byTag.get(Tags.PRIMOP) ?? [])];
	return externals.reduce((acc, extId) => {
		const args = sortByIndex(Edges.byLabel(extId, Labels.ARG)(acc));
		return args.reduce((a, edge, i) => (i > 0 ? Edges.add(args[i - 1].target, Labels.NEXT, edge.target)(a) : a), acc);
	}, g);
};

const resolvePrimops: Rule = {
	lhs: {
		nodes: [{ bind: "$ext", tag: Tags.EXTERNAL, payload: p => p.saturated === true && typeof p.name === "string" && ARITIES[p.name] !== undefined }],
		edges: [],
	},
	rhs: {
		nodes: [
			{
				bind: "$ext",
				tag: Tags.PRIMOP,
				payload: (b, host) => {
					const node = Nodes.get(b.get("$ext") ?? -1)(host);

					if (node === undefined) {
						throw new Error("saturate: $ext node missing for primop");
					}
					return { op: P.string(node.payload, "name") };
				},
				provenance: PASS,
			},
		],
		edges: [],
	},
};

export const saturate: Strategy.Pass = Strategy.seq(
	Strategy.apply(initial),
	Strategy.derive(accumulateAnchor, buildAccumulate),
	chainArgs,
	Strategy.apply(resolvePrimops),
);

export const descriptor: Descriptor = {
	name: "saturate",
	requires: {
		tags: new Set([Tags.APP, Tags.VAR_REF, Tags.VAR_FOREIGN]),
		labels: new Set([Labels.FUNC, Labels.ARG, Labels.REFERS_TO]),
	},
	delta: {
		tags: { added: new Set([Tags.EXTERNAL, Tags.PRIMOP]), removed: new Set() },
		labels: { added: new Set([Labels.CALLEE, Labels.NEXT]), removed: new Set() },
	},
	run: saturate,
};
