import { describe, expect, it } from "vitest";
import { Build } from "../../../ivl/build";
import * as DSL from "../../../ivl/dsl";
import { Print as IVLPrint } from "../../../ivl/print";
import type { IVL } from "../../../ivl/types";
import { Solver } from "../../solver";
import * as Print from "../print";
import * as Replay from "../replay";

const contradiction = DSL.and(DSL.eq(DSL.x, DSL.int(1)), DSL.not(DSL.eq(DSL.x, DSL.int(1))));
const eufContradiction = DSL.and(DSL.eq(DSL.x, DSL.y), DSL.neq(DSL.x, DSL.y));
const replay = (formula: IVL.Formula): string => {
	const check = Solver.run(formula);
	return Replay.replay({
		formula: IVLPrint.formula(formula),
		steps: check.steps,
		encoding: check.encoding,
		arena: check.arena,
	});
};

describe("v2 trace presentation", () => {
	it("formats solver events with atom text", () => {
		const check = Solver.run(contradiction);

		const output = Print.format(check.steps, check.encoding);

		expect(output).toContain("[unsat]");
		expect(output).toContain("= x 1");
		expect(output.split("\n").length).toBeGreaterThan(1);
	});

	it("replays a run with formula and trace sections", () => {
		const check = Solver.run(contradiction);

		const output = Replay.replay({
			formula: IVLPrint.formula(contradiction),
			steps: check.steps,
			encoding: check.encoding,
			arena: check.arena,
		});

		expect(output).toContain("=== Formula ===");
		expect(output).toContain("=== Variables ===");
		expect(output).toContain("=== Registry ===");
		expect(output).toContain("=== Trace ===");
		expect(output).toContain("(and");
		expect(output).toContain("[unsat]");
	});

	it("can hide the registry section", () => {
		const check = Solver.run(contradiction);

		const output = Replay.replay({
			formula: IVLPrint.formula(contradiction),
			steps: check.steps,
			encoding: check.encoding,
			arena: check.arena,
			showRegistry: false,
		});

		expect(output).not.toContain("=== Registry ===");
		expect(output).toContain("=== Trace ===");
	});

	it("replays EUF registry, active literals, merges, and conflicts", () => {
		const check = Solver.run(eufContradiction);

		const output = Replay.replay({
			formula: IVLPrint.formula(eufContradiction),
			steps: check.steps,
			encoding: check.encoding,
			arena: check.arena,
		});

		expect(output).toContain("active (= x y)");
		expect(output).toContain("merge x = y");
		expect(output).toContain("active (!= x y)");
		expect(output).toContain("scan active (!= x y) -> same class, conflict");
		expect(output).toContain("euf:disequality-conflict");
	});

	describe("replay snapshots", () => {
		it("propositional contradiction", () => {
			expect(replay(contradiction)).toMatchSnapshot();
		});

		it("EUF contradiction", () => {
			expect(replay(eufContradiction)).toMatchSnapshot();
		});

		it("arithmetic UNSAT", () => {
			const formula = DSL.and(DSL.lte(DSL.add(DSL.x, DSL.y), DSL.int(5)), DSL.gte(DSL.x, DSL.int(3)), DSL.gte(DSL.y, DSL.int(3)));

			expect(replay(formula)).toMatchSnapshot();
		});

		it("arithmetic SAT", () => {
			const formula = DSL.and(DSL.gte(DSL.x, DSL.int(0)), DSL.lte(DSL.x, DSL.int(10)));

			expect(replay(formula)).toMatchSnapshot();
		});

		it("quantifier UNSAT", () => {
			const f_x = Build.app("f", [DSL.x], Build.Int);
			const f_a = Build.app("f", [Build.const_("a", Build.Int)], Build.Int);
			const formula = DSL.and(
				DSL.eq(f_a, DSL.int(1), "f_a_is_1"),
				DSL.forall([{ name: "x", sort: Build.Int }], DSL.neq(f_x, DSL.int(1)), "forall_f_neq_1", [{ terms: [f_x] }]),
			);

			expect(replay(formula)).toMatchSnapshot();
		});
	});
});
