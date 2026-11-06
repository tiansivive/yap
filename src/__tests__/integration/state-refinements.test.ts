import { describe, expect, test } from "vitest";
import { runScript } from "./helpers/pipeline";

/* Each declaration's validity, or its stage errors when verification did not run. */
const verdicts = (source: string): Record<string, string> =>
	Object.fromEntries(runScript(source).declarations.map(d => [d.name, d.stages?.validity || JSON.stringify(d.errors)]));

describe("Refinements over the verifier's state", () => {
	test("a capture verifies only where its identity is live", () => {
		expect(
			verdicts(`
foreign Ask: Effect Unit Num;
foreign Exn: Effect String Num;
let handled = with Ask: (\\p k -> k 1) in capture [Ask] !;
let unhandled = capture [Ask] !;
let other = with Exn: (\\e k -> 0) in capture [Ask] !;
let nested = with Exn: (\\e k -> 0), Ask: (\\p k -> k 1) in capture [Ask] !;
			`),
		).toMatchObject({ handled: "valid", unhandled: "invalid", other: "invalid", nested: "valid" });
	});

	test("a function states the requirement of its body's capture on its parameter", () => {
		expect(
			verdicts(`
foreign Ask: Effect Unit Num;
let ask: (u: Unit [| \\st u -> live st Ask |]) -> Num = \\u -> capture [Ask] u;
let inside = with Ask: (\\p k -> k 1) in ask !;
let outside = ask !;
			`),
		).toMatchObject({ ask: "valid", inside: "valid", outside: "invalid" });
	});

	test("a function without the requirement cannot capture", () => {
		expect(
			verdicts(`
foreign Ask: Effect Unit Num;
let ask = \\u -> capture [Ask] u;
			`),
		).toMatchObject({ ask: "invalid" });
	});

	test("a closure that escapes its handler carries the requirement to its call", () => {
		expect(
			verdicts(`
foreign Ask: Effect Unit Num;
let ask: (u: Unit [| \\st u -> live st Ask |]) -> Num = \\u -> capture [Ask] u;
let g: (u: Unit [| \\st u -> live st Ask |]) -> Num = with Ask: (\\p k -> k 1) in (\\u -> ask u);
let escaped = g !;
let reinstalled = with Ask: (\\p k -> k 2) in g !;
			`),
		).toMatchObject({ g: "valid", escaped: "invalid", reinstalled: "valid" });
	});

	test("a function passed as an argument is compared at its caller's state", () => {
		expect(
			verdicts(`
foreign Ask: Effect Unit Num;
let ask: (u: Unit [| \\st u -> live st Ask |]) -> Num = \\u -> capture [Ask] u;
let run: (f: Unit -> Num) -> Num = \\f -> f !;
let runLive: (f: (u: Unit [| \\st u -> live st Ask |]) -> Num) -> Num = \\f -> with Ask: (\\p k -> k 1) in f !;
let bad = run ask;
let good = runLive ask;
			`),
		).toMatchObject({ runLive: "valid", bad: "invalid", good: "valid" });
	});

	test("a capture in an expression statement is checked", () => {
		expect(
			verdicts(`
foreign Ask: Effect Unit Num;
let f: Unit -> Num = \\u -> { capture [Ask] u; return 1; };
			`),
		).toMatchObject({ f: "invalid" });
	});

	test("a capture in a block let is checked", () => {
		expect(
			verdicts(`
foreign Ask: Effect Unit Num;
let r = { let x = capture [Ask] !; return x; };
			`),
		).toMatchObject({ r: "invalid" });
	});

	test("a predicate over values refines through a lambda over the state", () => {
		expect(
			verdicts(`
let positive = \\v -> v > 0;
let x: Num [| \\st -> positive |] = 5;
let y: Num [| \\st -> positive |] = 0;
			`),
		).toMatchObject({ x: "valid", y: "invalid" });
	});
});
