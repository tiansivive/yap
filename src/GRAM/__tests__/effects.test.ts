import { describe, expect, it } from "vitest";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as GRAM from "../index";
import { interpret } from "../../lowering/interpret";
import { ARITIES } from "../../lowering/shared/primops";
import { evaluate, mkCtx, runNF } from "../../elaboration/inference/__tests__/util";
import { readFileSync } from "node:fs";
import * as JS from "../../Codegen/v2/js";
import { Edges, Nodes, Query } from "../graph";
import { Labels, Tags } from "../vocabulary";

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
		["abort", 0],
		["evidence-record", 42],
		["handler-evaluated-once", 42],
		["handler-function", 42],
		["multiple-handlers", 42],
		["multishot", 23],
		["nested-handlers", 40],
		["raw-control0", 999],
		["raw-named", 12],
		["raw-shift0", 2099],
		["rethrow", 111],
		["using-evidence", 42],
	] as const)("compiles the %s example", (name, expected) => {
		expect(compiled(readFileSync(`examples/effects/${name}.yap`, "utf8").trim())).toBe(expected);
	});

	it("extracts the residual body through two calls and shares it across resumptions", () => {
		const source = `{ foreign E: Effect Num Num;
			let f = \\x -> 1 + (capture [E] x);
			let g = \\y -> 2 * (f y);
			return with E: (\\p k -> (k p) + (k (p + 1))) in 10 + (g 3); }`;
		expect(compiled(source)).toBe(38);
		const graph = GRAM.Pipeline.compile(evaluate(source).core, { arities: ARITIES });
		if (graph._tag === "Left") {
			throw new Error(JSON.stringify(graph.left));
		}
		const g = graph.right;
		const ks = [...Query.byTag(Tags.CONTINUATION)(g)];
		expect(ks).toHaveLength(1);
		const k = ks[0];
		const hole = Query.follow(k, Labels.HOLE)(g)!;
		expect(Nodes.get(hole)(g)?.tag).toBe(Tags.BUBBLE);
		expect(Nodes.get(Query.follow(k, Labels.CAPTURED_AT)(g)!)(g)?.tag).toBe(Tags.CAPTURE);
		expect(Query.follow(k, Labels.BODY)(g)).toBeDefined();
		expect(Edges.to(k)(g).filter(e => e.label === Labels.INVOKES)).toHaveLength(2);
		const mir = GRAM.Bridge.emit(g);
		expect(mir.functions[0].blocks.filter(b => b.label === `k${k}`)).toHaveLength(1);
		expect(mir.functions[0].blocks.filter(b => b.terminator.type === "Jump" && b.terminator.target === `k${k}`)).toHaveLength(2);
	});

	it.each([0, 1])("keeps both match branches in a capturing helper (%s)", value => {
		const source = `{ foreign E: Effect Num Num;
			let f = \\x -> match x | 0 -> capture [E] 20 | _ -> capture [E] 30;
			return with E: (\\p k -> k p) in 10 + (f ${value}); }`;
		expect(compiled(source)).toBe(value === 0 ? 30 : 40);
		const mir = lower(evaluate(source).core);
		expect(mir.functions[0].blocks.some(b => b.terminator.type === "Branch" && b.terminator.cases.some(c => c.value === "0"))).toBe(true);
	});

	it("branches inside one shared continuation using each resumption's argument", () => {
		expect(compiled("with E: (\\p k -> (k 0) + (k 1)) in match (capture [E] 0) | 0 -> 11 | _ -> 22")).toBe(33);
	});

	it("saves a runtime value computed before capture once for both resumptions", () => {
		const source = `{ foreign E: Effect Num Num; foreign read: Unit -> Num;
			let f = \\x -> { let saved = read !; return saved + (capture [E] x); };
			return with E: (\\p k -> (k p) + (k (p + 1))) in 10 + (f 3); }`;
		const graph = GRAM.Pipeline.compile(evaluate(source).core, { arities: { ...ARITIES, read: 1 } });
		if (graph._tag === "Left") {
			throw new Error(JSON.stringify(graph.left));
		}
		const mir = GRAM.Bridge.emit(graph.right);
		[20, 40].forEach(input => {
			let calls = 0;
			const read = () => {
				calls++;
				return input;
			};
			expect(interpret(mir, { read })).toBe(2 * input + 27);
			expect(calls).toBe(1);
		});
	});

	it("associates one source capture with distinct call-site delimiters", () => {
		const source = `{ foreign E: Effect Num Num;
			let f = \\x -> 1 + (capture [E] x);
			return (with E: (\\p k -> (k p) + (k (p + 1))) in 10 + (f 3))
			     + (with E: (\\p k -> (k p) + (k (p + 1))) in 100 + (f 3)); }`;
		expect(compiled(source)).toBe(238);
		const graph = GRAM.Pipeline.compile(evaluate(source).core, { arities: ARITIES });
		if (graph._tag === "Left") {
			throw new Error(JSON.stringify(graph.left));
		}
		const g = graph.right;
		const ks = [...Query.byTag(Tags.CONTINUATION)(g)];
		expect(ks).toHaveLength(2);
		expect(new Set(ks.map(k => Query.follow(k, Labels.CAPTURED_AT)(g))).size).toBe(1);
		expect(new Set(ks.map(k => Query.follow(k, Labels.DELIMITER)(g))).size).toBe(2);
		expect(new Set(ks.map(k => Query.follow(k, Labels.BODY)(g))).size).toBe(2);
	});
});
