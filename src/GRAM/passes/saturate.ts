import { Nodes, Edges } from "../graph";
import type { Graph } from "../graph";
import { Tags, Labels } from "../vocabulary";
import type { Rule, Bindings } from "../grs";
import * as Strategy from "../grs/strategy";
import { ARITIES } from "../../lowering/shared/primops";

const PASS = { created_by: "saturate" } as const;

// ── Rule 1: app(ref → foreign) → external ──

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
					const name = (node?.payload.name as string) ?? "";
					const arity = (node?.payload.arity as number) ?? 0;
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

// ── Rule 2: app(external) → external (accumulate) ──

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
	const prev = Nodes.get(extId)(host)?.payload ?? {};
	const args = (prev.args as number) ?? 0;
	const arity = (prev.arity as number) ?? 0;

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

// ── Add :next chains between args ──

const chainArgs: Strategy.Pass = (g: Graph): Graph => {
	const externals = [...(g.byTag.get(Tags.EXTERNAL) ?? []), ...(g.byTag.get(Tags.PRIMOP) ?? [])];
	return externals.reduce((acc, extId) => {
		const args = Edges.byLabel(
			extId,
			Labels.ARG,
		)(acc)
			.slice()
			.sort((a, b) => ((a.payload.index as number) ?? 0) - ((b.payload.index as number) ?? 0));

		return args.reduce((a, edge, i) => (i > 0 ? Edges.add(args[i - 1].target, Labels.NEXT, edge.target)(a) : a), acc);
	}, g);
};

// ── Rule 3: saturated primop external → primop ──

const resolvePrimops: Rule = {
	lhs: {
		nodes: [{ bind: "$ext", tag: Tags.EXTERNAL, payload: p => p.saturated === true && ARITIES[p.name as string] !== undefined }],
		edges: [],
	},
	rhs: {
		nodes: [
			{
				bind: "$ext",
				tag: Tags.PRIMOP,
				payload: (b, host) => ({ op: (Nodes.get(b.get("$ext") ?? -1)(host)?.payload.name as string) ?? "" }),
				provenance: PASS,
			},
		],
		edges: [],
	},
};

// ── Pass ──

export const saturate: Strategy.Pass = Strategy.seq(
	Strategy.apply(initial),
	Strategy.derive(accumulateAnchor, buildAccumulate),
	chainArgs,
	Strategy.apply(resolvePrimops),
);
