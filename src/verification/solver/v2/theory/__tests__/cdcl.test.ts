import * as E from "fp-ts/Either";
import { describe, expect, it } from "vitest";
import { Build } from "../../../ivl/build";
import * as DSL from "../../../ivl/dsl";
import * as CDCL from "../../cdcl";
import * as Core from "../../core";
import { CNF } from "../../encoding/index";
import * as Theory from "../index";

const ten = DSL.int(10);

const solve = (formula: Parameters<typeof CNF.encode>[0]): { readonly result: CDCL.Result; readonly steps: readonly { readonly tag: string }[] } => {
	const encoding = CNF.encode(formula);
	const [, installed] = Core.run(
		Core.Do(function* () {
			return yield* Theory.install(encoding);
		}),
	);
	const [collector] = Core.run(CDCL.CDCL.solveTrace(encoding.clauses), Core.Env.default, installed);
	return E.match(
		(left: Core.Err) => ({ result: { tag: "unknown" as const, reason: left.cause.tag }, steps: collector.steps }),
		(result: CDCL.Result) => ({ result, steps: collector.steps }),
	)(collector.result);
};

describe("CDCL theory integration", () => {
	it("detects EUF congruence conflicts through CDCL search", () => {
		const fx = Build.app("f", [DSL.x], Build.Int);
		const fy = Build.app("f", [DSL.y], Build.Int);
		const { result } = solve(DSL.and(DSL.eq(DSL.x, DSL.y), DSL.neq(fx, fy)));

		expect(result.tag).toBe("unsat");
	});

	it("detects arithmetic bound conflicts through CDCL search", () => {
		const { result } = solve(DSL.and(DSL.gt(DSL.x, DSL.int(0)), DSL.lt(DSL.x, DSL.int(0))));

		expect(result.tag).toBe("unsat");
	});

	it("keeps satisfiable arithmetic constraints satisfiable", () => {
		const { result } = solve(DSL.and(DSL.gt(DSL.x, DSL.int(0)), DSL.lt(DSL.x, ten)));

		expect(result.tag).toBe("sat");
	});

	it("records theory assertion and check events", () => {
		const { steps } = solve(DSL.gte(DSL.x, DSL.int(0)));

		expect(steps.some(s => s.tag === "assert")).toBe(true);
		expect(steps.some(s => s.tag === "check")).toBe(true);
	});
});
