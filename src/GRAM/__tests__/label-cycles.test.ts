import { describe, it, expect, beforeEach } from "vitest";

import * as EB from "@yap/elaboration";
import { compile } from "../pipeline";
import { resetId } from "../graph";

const label = (name: string): EB.Term => EB.Constructors.Var({ type: "Label", name });

describe("label-cycles pass", () => {
	beforeEach(() => {
		EB.resetId();
		resetId();
	});

	it("acyclic struct compiles", () => {
		const term = EB.DSL.struct([
			{ label: "width", value: EB.DSL.num(10) },
			{ label: "area", value: label("width") },
		]);
		expect(() => compile(term)).not.toThrow();
	});

	it("eager self-cycle is rejected", () => {
		const term = EB.DSL.struct([
			{ label: "a", value: label("b") },
			{ label: "b", value: label("a") },
		]);
		expect(() => compile(term)).toThrow(/eager cyclic field reference/);
	});

	it("lambda-guarded self-cycle compiles (knot ties it)", () => {
		const term = EB.DSL.struct([{ label: "compute", value: EB.DSL.lambda("n", label("compute"), EB.DSL.type("Num")) }]);
		expect(() => compile(term)).not.toThrow();
	});
});
