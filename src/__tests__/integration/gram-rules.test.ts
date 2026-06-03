import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Programmable GRAM passes", () => {
	test("tailcall identification rule marks app in tail position", () => {
		const result = runScript(`
let tailcallRule: Rule = {
	lhs: {
		nodes: [
			{ bind: "lam", tag: "lambda" },
			{ bind: "app", tag: "app" }
		],
		edges: [
			{ source: "lam", label: ":body", target: "app" }
		]
	},
	rhs: {
		nodes: [
			{ bind: "lam", tag: "lambda", payload: "{}" },
			{ bind: "app", tag: "app", payload: "{\\"tailcall\\": true}" }
		],
		edges: [
			{ source: "lam", label: ":body", target: "app" }
		]
	}
};

let f: Num -> Num = \\x -> x;

let annotated: Num -> Num = (\\x -> f x) %tailcallRule;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("gram modality without rule is a no-op", () => {
		const result = runScript(`
let f: Num -> Num = \\x -> x;

let plain: Num -> Num = \\y -> f y;
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("gram rule on literal", () => {
		const result = runScript(`
let markLit: Rule = {
	lhs: {
		nodes: [{ bind: "n", tag: "lit" }],
		edges: []
	},
	rhs: {
		nodes: [{ bind: "n", tag: "lit", payload: "{\\"marked\\": true}" }],
		edges: []
	}
};

let result = 42 %markLit;
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
