import { describe, expect, it } from "vitest";
import * as DSL from "../../../ivl/dsl";
import { Print as IVLPrint } from "../../../ivl/print";
import { Solver } from "../../solver";
import * as Print from "../print";
import * as Replay from "../replay";

const contradiction = DSL.and(DSL.eq(DSL.x, DSL.int(1)), DSL.not(DSL.eq(DSL.x, DSL.int(1))));

describe("v2 trace presentation", () => {
	it("formats solver events with atom text", () => {
		const solver = Solver.createTraced();
		solver.assert(contradiction);
		const check = solver.check();

		const output = Print.format(check.steps, check.encoding);

		expect(output).toContain("[unsat]");
		expect(output).toContain("= x 1");
		expect(output.split("\n").length).toBeGreaterThan(1);
	});

	it("replays a run with formula and trace sections", () => {
		const solver = Solver.createTraced();
		solver.assert(contradiction);
		const check = solver.check();

		const output = Replay.replay({
			formula: IVLPrint.formula(contradiction),
			steps: check.steps,
			encoding: check.encoding,
		});

		expect(output).toContain("=== Formula ===");
		expect(output).toContain("=== Trace ===");
		expect(output).toContain("(and");
		expect(output).toContain("[unsat]");
	});
});
