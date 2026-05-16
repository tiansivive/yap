import { Query } from "../graph";
import { Tags, Labels, isStructural } from "../vocabulary";
import type { Rule } from "../grs";
import * as Strategy from "../grs/strategy";

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

export const eta: Strategy.Pass = Strategy.apply(rule);
