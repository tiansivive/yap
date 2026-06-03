import type * as EB from "@yap/elaboration";
import type * as NF from "@yap/elaboration/normalization";

import type { Graph, NodeId } from "../graph";
import { Query, Nodes, Edges } from "../graph";
import { Tags, Labels } from "../vocabulary";
import type { Rule } from "../grs/rule";
import { Match } from "../grs/match";
import * as Rewrite from "../grs/rewrite";
import * as Reader from "../grs/reader";

type RuleDiscovery = {
	readonly modalId: NodeId;
	readonly ruleName: string;
	readonly rule: Rule;
};

const getRuleName = (ruleNodeId: NodeId, g: Graph): string | undefined => {
	const node = Nodes.get(ruleNodeId)(g);

	return node?.tag === Tags.VAR_FREE
		? (node.payload.name as string)
		: node?.tag === Tags.VAR_REF
			? (() => {
					const defId = Query.follow(ruleNodeId, Labels.REFERS_TO)(g);
					return defId !== undefined ? (Nodes.get(defId)(g)?.payload.name as string) : undefined;
				})()
			: undefined;
};

const discoverRules = (g: Graph, ctx: EB.Context): ReadonlyArray<RuleDiscovery> => {
	const modalIds = Query.byTag(Tags.MODAL)(g);
	const discoveries: RuleDiscovery[] = [];

	for (const modalId of modalIds) {
		const ruleEdge = Edges.one(modalId, Labels.REWRITE_RULE)(g);

		if (ruleEdge === undefined) {
			continue;
		}

		const ruleName = getRuleName(ruleEdge.target, g);

		if (ruleName === undefined) {
			continue;
		}

		const imported = ctx.imports[ruleName];

		if (imported === undefined) {
			continue;
		}

		const [, nfValue] = imported;

		try {
			const rule = Reader.read(nfValue);
			discoveries.push({ modalId, ruleName, rule });
		} catch {
			continue;
		}
	}

	return discoveries;
};

const deduplicateByName = (discoveries: ReadonlyArray<RuleDiscovery>): ReadonlyArray<RuleDiscovery> => {
	const seen = new Set<string>();
	return discoveries.filter(d => {
		if (seen.has(d.ruleName)) {
			return false;
		}
		seen.add(d.ruleName);
		return true;
	});
};

const applyRule = (rule: Rule, g: Graph): Graph => {
	const matches = Match.all(rule, g);
	return matches.reduce<Graph>((acc, bindings) => Rewrite.apply(rule, acc, bindings) ?? acc, g);
};

export const run = (g: Graph, ctx: EB.Context | undefined): Graph => {
	if (ctx === undefined) {
		return g;
	}

	const discoveries = discoverRules(g, ctx);
	const unique = deduplicateByName(discoveries);

	return unique.reduce((acc, { rule }) => applyRule(rule, acc), g);
};
