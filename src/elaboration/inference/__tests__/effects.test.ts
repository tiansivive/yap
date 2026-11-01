import { describe, expect, it } from "vitest";
import { elaborateFrom, evaluate } from "./util";
import { readFileSync } from "node:fs";

describe("effect expression spike", () => {
	it("discharges the effects handled inside a pure function", () => {
		const source = String.raw`{ foreign E: Effect Num Num; let f = \x -> capture [E] x; let run: Num -> Num = \base -> with E: (\p k -> (k p) + (k (p + 1))) in base + (f 3); return run 10; }`;
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value: 27 } });
	});

	it("shares one evidence parameter across repeated captures", () => {
		const { displays } = elaborateFrom(String.raw`{ foreign E: Effect Num Num; return \x -> (capture [E] x) + (capture [E] x); }`);
		expect(displays.type.match(/: FFI.E/g)).toHaveLength(1);
	});

	it("preserves the identity and its evidence in a polymorphic control helper", () => {
		const source = String.raw`{ foreign E: Effect ((Num -> Num) -> Num) Num; let shift0 = \e => \f -> capture [e] (\k -> f (\v -> reset [e] (k v))); return reset [E] (10 + (shift0 @Num @Num @E (\k -> k 1))); }`;
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value: 11 } });
	});

	it("reinstalls the helper's explicit identity for subsequent captures", () => {
		const source = String.raw`{ foreign E: Effect ((Num -> Num) -> Num) Num; let shift0 = \e => \f -> capture [e] (\k -> f (\v -> reset [e] (k v))); return reset [E] ((shift0 @Num @Num @E (\k -> 100 + (k 1))) + (capture [E] (\k -> 999))); }`;
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value: 1099 } });
	});

	it("retains the effect requirement on a returned function", () => {
		const source = String.raw`{ foreign E: Effect Num Num; let make = \x -> \y -> capture [E] (x + y); let f = make 1; return with E: (\p k -> k p) in f 2; }`;
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value: 3 } });
		expect(elaborateFrom(source).displays.term).toMatch(/Π\(x: Num\) ->[\s\S]*Π\(e0: FFI.E\) =>/);
	});

	it.each([
		["with E: (\\p k -> 42) in capture [E] 1", 42],
		["{ foreign E: Effect ((Num -> Num) -> Num) Num; return reset [E] (10 + (capture [E] (\\k -> k 2))); }", 12],
		["with E: (\\p k -> k p) in (capture [E] 1) + (capture [E] 2)", 3],
		["with E: (\\p k -> k p), F: (\\p k -> k (p + 10)) in (capture [E] 1) + (capture [F] 2)", 13],
		["with E: (\\p k -> p) in with E: (\\p k -> capture [E] (p + 10)) in capture [E] 1", 11],
		["{ foreign E: Effect Num Num; return with E: (\\p k -> k p) in capture [E] 7; }", 7],
		["reset (1000 + (reset (10 + (capture (\\k -> capture (\\k2 -> 100))))))", 100],
		["{ foreign E: Effect Num Num; let op = \\x -> capture [E] x; return with E: (\\p k -> k (p + 1)) in op 7; }", 8],
		["{ foreign E: Effect Num Num; let op = \\x -> capture [E] x; return with E: (\\p k -> k p) in (op 1) + (op 2); }", 3],
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

	it.each([
		["probe1", 1099],
		["probe2", 100],
		["probe3", 1099],
	] as const)("evaluates %s with explicit sharing", (name, value) => {
		const source = readFileSync(`examples/effects/${name}.yap`, "utf8").trim();
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value } });
	});

	it("gives nested anonymous resets distinct identities", () => {
		const { core, value } = evaluate(String.raw`reset (reset (capture (\k -> k 2)))`);
		expect(core).toMatchObject({ type: "Reset", term: { type: "Reset" } });

		if (core.type !== "Reset" || core.term.type !== "Reset") {
			throw new Error("Expected nested resets");
		}
		expect(core.identity).not.toEqual(core.term.identity);
		expect(value).toMatchObject({ type: "Lit", value: { type: "Num", value: 2 } });
	});

	it("keeps an anonymous requirement scoped to its reset", () => {
		expect(() => elaborateFrom(String.raw`reset (\x -> capture (\k -> k x))`)).toThrow(/Local effect identity anonymous escapes/);
		expect(evaluate(String.raw`reset { let f = \x -> capture (\k -> k x); return f 2; }`).value).toMatchObject({
			type: "Lit",
			value: { type: "Num", value: 2 },
		});
	});

	it("keeps a fresh reset independent of the resumed identity", () => {
		expect(() => evaluate(String.raw`reset ((capture (\k -> reset (k 1))) + (capture (\k -> 2)))`)).toThrow(/live delimiter for \$anonymous/);
	});

	it("evaluates the four operators packaged together", () => {
		const source = readFileSync("examples/effects/control.yap", "utf8").trim();
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value: 11 } });
	});
});
