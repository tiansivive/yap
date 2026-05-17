import * as E from "fp-ts/Either";

import type { Graph, Edge } from "../graph";
import { entry } from "../graph";
import type { Tag } from "../vocabulary";
import type { Vocabulary } from "./descriptor";

export type Violation =
	| { readonly type: "DanglingEdge"; readonly edge: Edge }
	| { readonly type: "NoEntry" }
	| { readonly type: "UnexpectedTag"; readonly tag: Tag; readonly nodeIds: ReadonlySet<number> };

const allEdges = (g: Graph): ReadonlyArray<Edge> => [...g.edges.values()].flatMap(m => [...m.values()].flat());

const danglingEdges = (g: Graph): ReadonlyArray<Violation> =>
	allEdges(g)
		.filter(e => !g.nodes.has(e.source) || !g.nodes.has(e.target))
		.map((edge): Violation => ({ type: "DanglingEdge", edge }));

const missingEntry = (g: Graph): ReadonlyArray<Violation> => (entry(g) === undefined ? [{ type: "NoEntry" }] : []);

const unexpectedTags = (g: Graph, expected: ReadonlySet<Tag>): ReadonlyArray<Violation> =>
	[...g.byTag.entries()]
		.filter(([tag, ids]) => !expected.has(tag) && ids.size > 0)
		.map(([tag, ids]): Violation => ({ type: "UnexpectedTag", tag, nodeIds: ids }));

export const verify = (g: Graph, vocabulary?: Vocabulary): E.Either<ReadonlyArray<Violation>, Graph> => {
	const violations = [...danglingEdges(g), ...missingEntry(g), ...(vocabulary ? unexpectedTags(g, vocabulary.tags) : [])];
	return violations.length > 0 ? E.left(violations) : E.right(g);
};
