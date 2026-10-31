import { describe, expect, it } from "vitest";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Errors from "@yap/elaboration/shared/errors";
import * as Eff from "@yap/utils/effects";
import { mkCtx, parseExpr, runEB, shown } from "./util";

export const evaluate = (source: string) => {
	const ctx = mkCtx();
	const { answer, registry } = runEB(ctx, function* () {
		const [term, type] = yield* EB.infer(parseExpr(source));
		const { resolutions } = yield* EB.solve((yield* M.writer.peek()).constraints);
		const core = yield* EB.Icit.instantiate(term, resolutions);
		return { core, type, value: yield* NF.normalize(core) };
	});
	if (Eff.failed(answer)) throw new Error(shown(ctx, registry)(() => Errors.report(answer[Eff.ABORT])));
	return answer;
};

describe("effect expression spike", () => {
	it.each([
		["with E: (\\p k -> 42) in capture [E] 1", 42],
		["with E: (\\p k -> k p) in (capture [E] 1) + (capture [E] 2)", 3],
		["with E: (\\p k -> k p), F: (\\p k -> k (p + 10)) in (capture [E] 1) + (capture [F] 2)", 13],
		["with E: (\\p k -> p) in with E: (\\p k -> capture [E] (p + 10)) in capture [E] 1", 11],
		["{ foreign E: Effect Num Num; return with E: (\\p k -> k p) in capture [E] 7; }", 7],
		["reset ((capture (\\k -> 100 + (resume 1))) + (capture (\\k -> 999)))", 1099],
		["reset (1000 + (reset (10 + (capture (\\k -> capture (\\k2 -> 100))))))", 100],
		["{ foreign E: Effect Num Num; let op = \\x -> capture [E] x; return with E: (\\p k -> k (p + 1)) in op 7; }", 8],
		["{ foreign E: Effect Num Num; let op = \\x -> capture [E] x; return with E: (\\p k -> k p) in (op 1) + (op 2); }", 3],
		["{ let later = reset ((capture (\\k -> \\u -> resume u)) + (capture (\\k -> 999))); return reset (100 + (later 5)); }", 1099],
		["{ foreign E: Effect Num Num; let op = \\(r: { E: E }) -> \\x -> capture [r.E] x; return with E: (\\p k -> k p) in op { E: E } 7; }", 7],
		["{ foreign E: Effect Num Num; let op = \\x -> capture [E] x; let run = \\(r: { E: E }) -> \\x -> { using r; return op x; }; return with E: (\\p k -> k p) in run { E: E } 7; }", 7],
		["{ foreign Exn: (a: Type) => Effect String a; return with Exn: (\\p k -> 0) in 1 + (capture [Exn] \"oops\"); }", 0],
		["{ foreign E: (a: Type) => Effect a a; return with E: (\\p k -> k p) in capture [E] 41; }", 41],
	] as const)("evaluates %s", (source, value) => {
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value } });
	});

	it("rejects an effectful function at a pure function type", () => {
		expect(() => evaluate("{ foreign E: Effect Num Num; let f: Num -> Num = \\x -> capture [E] x; return 1; }")).toThrow(/effect evidence/);
	});

	it("rejects a function that returns a requirement on its local identity", () => {
		expect(() => evaluate("with E: (\\p k -> k p) in (\\x -> capture [E] x)")).toThrow(/Local effect identity E escapes/);
	});

	it("checks result-polymorphic handlers for every result type", () => {
		expect(() => evaluate('{ foreign Exn: (a: Type) => Effect String a; return with Exn: (\\p k -> k 42) in 1 + (capture [Exn] "oops"); }')).toThrow(/Cannot unify/);
	});

	it("allows lexical answer-type modification and checks branch agreement", () => {
		expect(evaluate('reset (1 + (capture (\\k -> "hello")))').value).toMatchObject({ type: "Lit", value: { type: "String", value: "hello" } });
		expect(() => evaluate('reset (match false | true -> 1 + (capture (\\k -> "hello")) | false -> 2)')).toThrow(/Cannot unify/);
	});
});
