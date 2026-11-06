import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runScript } from "./helpers/pipeline";

/* Each declaration's validity, or its stage errors when verification did not run. */
const verdicts = (file: string): Record<string, string> =>
	Object.fromEntries(runScript(readFileSync(join("examples", file), "utf8")).declarations.map(d => [d.name, d.stages?.validity || JSON.stringify(d.errors)]));

describe("Effect examples verify as examples/INDEX.md lists", () => {
	test.each([
		["effects/handled.yap", { answer: "valid" }],
		["effects/operation.yap", { ask: "valid", twice: "valid" }],
		["effects/nested-handlers.yap", { nearest: "valid" }],
		["effects/multiple-handlers.yap", { ask: "valid", scale: "valid", scaled: "valid" }],
		["effects/handler-function.yap", { doubled: "valid" }],
		["effects/yield.yap", { yield: "valid", total: "valid" }],
		["effects/escaping-closure.yap", { later: "valid", reinstalled: "valid" }],
		["effects/higher-order.yap", { handled: "valid", result: "valid" }],
		["effects/value-predicate.yap", { x: "valid", y: "valid" }],
		["effects/abort.yap", { aborted: "valid" }],
		["errors/unhandled.yap", { unhandled: "invalid" }],
		["errors/other-handler.yap", { other: "invalid" }],
		["errors/pure-function.yap", { declared: "invalid", inferred: "invalid" }],
		["errors/call-without-handler.yap", { outside: "invalid" }],
		["errors/escaped-closure.yap", { later: "valid", escaped: "invalid" }],
		["errors/pure-callback.yap", { run: "valid", result: "invalid" }],
		["errors/block-let.yap", { unchecked: "invalid" }],
	])("%s", (file, expected) => {
		expect(verdicts(file)).toMatchObject(expected);
	});
});
