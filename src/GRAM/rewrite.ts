import type { Graph } from "./graph";
import type { NodePattern, Bindings } from "./patterns";
import { matchAll } from "./patterns";

export type Builder = (bindings: Bindings, g: Graph) => Graph;

export type Rule = {
	readonly pattern: NodePattern;
	readonly builder: Builder;
};

export const applyOnce =
	(rule: Rule) =>
	(g: Graph): Graph | undefined => {
		const matches = matchAll(rule.pattern)(g);
		return matches.length > 0 ? rule.builder(matches[0].bindings, g) : undefined;
	};

export const apply =
	(rule: Rule) =>
	(g: Graph): Graph => {
		let current = g;
		for (;;) {
			const next = applyOnce(rule)(current);

			if (!next) {
				return current;
			}
			current = next;
		}
	};
