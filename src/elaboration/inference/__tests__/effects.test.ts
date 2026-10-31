import { describe, expect, it } from "vitest";
import { evaluate } from "./util";
import { readFileSync } from "node:fs";

describe("effect expression spike", () => {
	it.each([
		["with E: (\\p k -> 42) in capture [E] 1", 42],
		["{ foreign E: Effect ((Num -> Num) -> Num) Num; return reset [E] (10 + (capture [E] (\\k -> k 2))); }", 12],
		["with E: (\\p k -> k p) in (capture [E] 1) + (capture [E] 2)", 3],
		["with E: (\\p k -> k p), F: (\\p k -> k (p + 10)) in (capture [E] 1) + (capture [F] 2)", 13],
		["with E: (\\p k -> p) in with E: (\\p k -> capture [E] (p + 10)) in capture [E] 1", 11],
		["{ foreign E: Effect Num Num; return with E: (\\p k -> k p) in capture [E] 7; }", 7],
		["reset ((capture (\\k -> 100 + (reset (k 1)))) + (capture (\\k -> 999)))", 1099],
		["reset (1000 + (reset (10 + (capture (\\k -> capture (\\k2 -> 100))))))", 100],
		["{ foreign E: Effect Num Num; let op = \\x -> capture [E] x; return with E: (\\p k -> k (p + 1)) in op 7; }", 8],
		["{ foreign E: Effect Num Num; let op = \\x -> capture [E] x; return with E: (\\p k -> k p) in (op 1) + (op 2); }", 3],
		["{ let later = reset ((capture (\\k -> \\u -> reset (k u))) + (capture (\\k -> 999))); return reset (100 + (later 5)); }", 1099],
		["{ foreign E: Effect Num Num; let op = \\(r: { E: E }) -> \\x -> capture [r.E] x; return with E: (\\p k -> k p) in op { E: E } 7; }", 7],
		[
			"{ foreign E: Effect Num Num; let op = \\x -> capture [E] x; let run = \\(r: { E: E }) -> \\x -> { using r; return op x; }; return with E: (\\p k -> k p) in run { E: E } 7; }",
			7,
		],
		['{ foreign Exn: (a: Type) => Effect String a; return with Exn: (\\p k -> 0) in 1 + (capture [Exn] "oops"); }', 0],
		["{ foreign E: (a: Type) => Effect a a; return with E: (\\p k -> k p) in capture [E] 41; }", 41],
		[
			"{ foreign Await: (a: Type) => Effect (Unit -> a) a; let await = \\p -> capture [Await] p; return with Await: (\\p k -> k (p !)) in (await (\\u -> 20)) + (await (\\u -> 22)); }",
			42,
		],
		[
			"{ foreign Yield: Effect Num Unit; let yield = \\x -> capture [Yield] x; return with Yield: (\\p k -> p + (k !)) in { yield 1; yield 2; return 0; }; }",
			3,
		],
		["{ let shift0 = \\f -> capture (\\k -> f (\\v -> reset (k v))); return reset (10 + (shift0 (\\k -> k 1))); }", 11],
	] as const)("evaluates %s", (source, value) => {
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value } });
	});

	it("rejects an effectful function at a pure function type", () => {
		expect(() => evaluate("{ foreign E: Effect Num Num; let f: Num -> Num = \\x -> capture [E] x; return 1; }")).toThrow(/effect evidence/);
	});

	it("checks the raw reset application handler against the effect payload", () => {
		expect(() => evaluate("{ foreign E: Effect Num Num; let f = \\v -> capture [E] v; return reset [E] (f 10); }")).toThrow(/Cannot unify/);
	});

	it("rejects a function that returns a requirement on its local identity", () => {
		expect(() => evaluate("with E: (\\p k -> k p) in (\\x -> capture [E] x)")).toThrow(/Local effect identity E escapes/);
	});

	it("checks result-polymorphic handlers for every result type", () => {
		expect(() => evaluate('{ foreign Exn: (a: Type) => Effect String a; return with Exn: (\\p k -> k 42) in 1 + (capture [Exn] "oops"); }')).toThrow(
			/Cannot unify/,
		);
	});

	it("allows lexical answer-type modification and checks branch agreement", () => {
		expect(evaluate('reset (1 + (capture (\\k -> "hello")))').value).toMatchObject({ type: "Lit", value: { type: "String", value: "hello" } });
		expect(() => evaluate('reset (match false | true -> 1 + (capture (\\k -> "hello")) | false -> 2)')).toThrow(/Cannot unify/);
	});

	it("preserves anonymous evidence through a Control record", () => {
		const source = "{ let Control = { shift0: \\f -> capture (\\k -> f (\\v -> reset (k v))) }; return reset (10 + (Control.shift0 (\\k -> k 1))); }";
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value: 11 } });
	});

	it("evaluates the four operators packaged together", () => {
		const source = readFileSync("examples/effects/control.yap", "utf8").trim();
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value: 11 } });
	});
});
