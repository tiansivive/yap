import { describe, expect, it } from "vitest";
import "@yap/elaboration";
import * as GRAM from "../index";
import { interpret } from "../../lowering/interpret";
import { ARITIES } from "../../lowering/shared/primops";
import { evaluate } from "../../elaboration/inference/__tests__/util";

const compiled = (source: string) => {
	const { core } = evaluate(source);
	const graph = GRAM.Pipeline.compile(core, { arities: ARITIES });

	if (graph._tag === "Left") {
		throw new Error(JSON.stringify(graph.left));
	}
	return interpret(GRAM.Bridge.emit(graph.right));
};

describe("local effects lowering spike", () => {
	it.each([
		["with E: (\\p k -> 42) in capture [E] 1", 42],
		["with E: (\\p k -> k p) in 10 + (capture [E] 2)", 12],
		["with E: (\\p k -> (k 1) + (k 2)) in 10 + (capture [E] 0)", 23],
		["reset (10 + (capture (\\k -> resume 2)))", 12],
	] as const)("compiles %s", (source, result) => {
		expect(compiled(source)).toBe(result);
	});

	it("identifies the fragment that needs reified continuations", () => {
		expect(() => compiled("with E: (\\p k -> k p) in (capture [E] 1) + (capture [E] 2)")).toThrow(/multiple captures require continuation reification/);
	});
});
