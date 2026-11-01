import { describe, expect, it } from "vitest";
import { evaluate } from "../../elaboration/inference/__tests__/util";
import * as GRAM from "../index";
import { Edges, Query } from "../graph";
import { Labels, Tags } from "../vocabulary";
import { ARITIES } from "../../lowering/shared/primops";
import { enrich } from "../passes/control/enrich";

const input = (source: string) => {
	const core = evaluate(source).core;
	const pipeline = GRAM.Pipeline.defaultPipeline;
	if (pipeline._tag === "Left") {
		throw new Error(JSON.stringify(pipeline.left));
	}
	return pipeline.right.descriptors
		.filter(p => p.name !== "effects" && p.name !== "shift-reset")
		.reduce((g, p) => p.run(g), GRAM.translate(core, { arities: ARITIES }));
};

describe("additive continuation enrichment", () => {
	it("preserves source identities and edges across a shared cross-call continuation", () => {
		const before = input(`{ foreign E: Effect Num Num;
			let f = \\x -> 1 + (capture [E] x);
			let g = \\y -> 2 * (f y);
			return with E: (\\p k -> (k p) + (k (p + 1))) in 10 + (g 3); }`);
		const after = enrich(before);
		before.nodes.forEach((node, id) => {
			expect(after.nodes.get(id)).toEqual(node);
			Edges.outgoing(id)(before).forEach(edge => {
				expect(Edges.outgoing(id)(after)).toContainEqual(edge);
			});
		});
		expect(enrich(after)).toEqual(after);
		expect(Edges.one(after.root, Labels.MATERIALIZES)(after)).toBeUndefined();
		const ks = [...Query.byTag(Tags.CONTINUATION)(after)];
		expect(ks).toHaveLength(1);
		const k = ks[0];
		expect(Query.follow(k, Labels.HOLE)(after)).toBeDefined();
		expect(Query.follow(k, Labels.BODY)(after)).toBeDefined();
		expect(before.nodes.get(Query.follow(k, Labels.CAPTURED_AT)(after)!)?.tag).toBe(Tags.CAPTURE);
		expect(Edges.to(k)(after).filter(e => e.label === Labels.INVOKES)).toHaveLength(2);
		const reset = Query.follow(k, Labels.DELIMITER)(after)!;
		expect(Query.follow(reset, Labels.ENTRY)(after)).toBeDefined();
		expect(after.nodes.size - before.nodes.size).toBeLessThan(40);
	});
});
