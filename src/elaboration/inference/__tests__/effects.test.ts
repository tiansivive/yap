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
	] as const)("evaluates %s", (source, value) => {
		expect(evaluate(source).value).toMatchObject({ type: "Lit", value: { type: "Num", value } });
	});
});
