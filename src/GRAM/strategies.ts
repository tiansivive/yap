import type { Graph, NodeId } from "./graph";
import { Nodes, Query } from "./graph";
import type { Rule } from "./rewrite";
import { apply as applyRule } from "./rewrite";
import type { Tag } from "./vocabulary";

export type Pass = (g: Graph) => Graph;

export const seq =
	(...passes: Pass[]): Pass =>
	(g: Graph): Graph =>
		passes.reduce((acc, pass) => pass(acc), g);

export const onTag =
	(tag: Tag, f: (id: NodeId, g: Graph) => Graph): Pass =>
	(g: Graph): Graph =>
		[...Query.byTag(tag)(g)].reduce((acc, id) => (Nodes.get(id)(acc) ? f(id, acc) : acc), g);

export const untilFixpoint =
	(pass: Pass, max = 100): Pass =>
	(g: Graph): Graph => {
		let current = g;
		for (let i = 0; i < max; i++) {
			const next = pass(current);

			if (next.nodes === current.nodes && next.edges === current.edges) {
				return next;
			}
			current = next;
		}
		return current;
	};

export const bottomUp = (rule: Rule): Pass => applyRule(rule);

export const topDown = (rule: Rule): Pass => applyRule(rule);

export const when =
	(pred: (g: Graph) => boolean, pass: Pass): Pass =>
	(g: Graph): Graph =>
		pred(g) ? pass(g) : g;
