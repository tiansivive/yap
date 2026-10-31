import { describe, expect, it } from "vitest";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as GRAM from "../index";
import { interpret } from "../../lowering/interpret";
import { ARITIES } from "../../lowering/shared/primops";
import { evaluate, mkCtx, runNF } from "../../elaboration/inference/__tests__/util";
import { readFileSync } from "node:fs";
import * as JS from "../../Codegen/v2/js";

const lower = (core: EB.Term) => {
	const graph = GRAM.Pipeline.compile(core, { arities: ARITIES });

	if (graph._tag === "Left") {
		throw new Error(JSON.stringify(graph.left));
	}
	return GRAM.Bridge.emit(graph.right);
};

const compiled = (source: string) => {
	const { core, value } = evaluate(source);
	const mir = lower(core);
	const result = interpret(mir);
	expect(value).toMatchObject({ type: "Lit", value: { value: result } });
	// eslint-disable-next-line @typescript-eslint/no-implied-eval -- executing the emitted program checks the state transitions
	expect(new Function(JS.print(JS.emit(mir)))()).toEqual(result);
	return result;
};

describe("local effects lowering spike", () => {
	it.each([
		["with E: (\\p k -> 42) in capture [E] 1", 42],
		["with E: (\\p k -> k p) in 10 + (capture [E] 2)", 12],
		["with E: (\\p k -> (k 1) + (k 2)) in 10 + (capture [E] 0)", 23],
		["reset (10 + (capture (\\k -> reset (k 2))))", 12],
		["with E: (\\p k -> k p) in (capture [E] 1) + (capture [E] 2)", 3],
		["with Tick: (\\p k -> p + (k !)) in with E: ({ capture [Tick] 1; return \\p k -> k p; }) in (capture [E] 20) + (capture [E] 21)", 42],
		["{ foreign E: Effect ((Num -> Num) -> Num) Num; return reset [E] (10 + (capture [E] (\\k -> k 2))); }", 12],
	] as const)("compiles %s", (source, result) => {
		expect(compiled(source)).toBe(result);
	});

	it("lowers an ordinary recursive binding that reinstalls its handler", () => {
		const C = EB.Constructors;
		const D = EB.DSL;
		const identity = D.type("LibraryEffect");
		const handler = D.lambda("request", D.lambda("bare", C.Reset(D.app(D.bound(0), D.bound(1)), identity, D.bound(2)), EB.Any), EB.Any);
		const body = D.add(C.Capture(identity, D.num(1)), C.Capture(identity, D.num(2)));
		const core = C.Block([C.Stmt.Let("dispatch", handler, NF.Any)], C.Reset(body, identity, D.bound(0)));
		const mir = lower(core);
		expect(runNF(mkCtx(), () => NF.normalize(core))).toMatchObject({ type: "Lit", value: { value: 3 } });
		expect(interpret(mir)).toBe(3);
		// eslint-disable-next-line @typescript-eslint/no-implied-eval -- execute the emitted state machine
		expect(new Function(JS.print(JS.emit(mir)))()).toBe(3);
		expect(mir.functions[0].blocks.filter(block => block.terminator.type === "Jump").length).toBeGreaterThan(1);
	});

	it("identifies the fragment that needs reified continuations", () => {
		expect(() => compiled("reset (capture (\\k -> k))")).toThrow(/escaping functions or continuations require reification/);
	});

	it.each([
		["control", 11],
		["handlers", 42],
		["probe1", 1099],
		["probe2", 100],
		["probe3", 1099],
	] as const)("compiles the %s example", (name, expected) => {
		expect(compiled(readFileSync(`examples/effects/${name}.yap`, "utf8").trim())).toBe(expected);
	});
});
