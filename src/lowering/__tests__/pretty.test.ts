import { describe, it, expect, beforeEach } from "vitest";

import * as EB from "@yap/elaboration";
import * as Lit from "@yap/shared/literals";

import * as MIR from "../mir";
import * as Pretty from "../pretty";
import { lowerToMir } from "../lower";
import { resetSupply } from "../context";

describe("MIR pretty printer", () => {
	beforeEach(() => resetSupply());

	it("display.expr Lit(Num(42))", () => {
		const expr = MIR.Constructors.Expr.Lit(Lit.Num(42));
		expect(Pretty.display.expr(expr)).toBe("42");
	});

	it("display.expr PrimOp($add, [x, y])", () => {
		const expr = MIR.Constructors.Expr.PrimOp("$add", ["x", "y"]);
		expect(Pretty.display.expr(expr)).toBe("+(x, y)");
	});

	it("display.expr Var", () => {
		const expr = MIR.Constructors.Expr.Var("x0");
		expect(Pretty.display.expr(expr)).toBe("x0");
	});

	it("display.instr Let", () => {
		const instr = MIR.Constructors.Instr.Let("x", MIR.Constructors.Expr.Lit(Lit.Num(1)));
		expect(Pretty.display.instr(instr)).toBe("let x = 1");
	});

	it("display.instr Read", () => {
		const instr = MIR.Constructors.Instr.Read("x", "r", "result");
		expect(Pretty.display.instr(instr)).toBe("let result = read r.x");
	});

	it("display.instr Alloc", () => {
		const instr = MIR.Constructors.Instr.Alloc(
			{
				type: "Record",
				fields: [
					{ label: "a", value: "x" },
					{ label: "b", value: "y" },
				],
			},
			"r",
		);
		expect(Pretty.display.instr(instr)).toBe("let r = alloc { a: x, b: y }");
	});

	it("display.instr Update immutable", () => {
		const instr = MIR.Constructors.Instr.UpdateImmutable("base", "result", { type: "Record", fields: [{ label: "x", value: "v" }] });
		expect(Pretty.display.instr(instr)).toBe("let result = update-immutable base { x: v }");
	});

	it("display.instr Update fbip", () => {
		const instr = MIR.Constructors.Instr.UpdateFbip("base", [
			{ label: "x", value: "v1" },
			{ label: "y", value: "v2" },
		]);
		expect(Pretty.display.instr(instr)).toBe("update-fbip base { x: v1, y: v2 }");
	});

	it("display.block with one Let and Return", () => {
		const block = MIR.Constructors.Block(
			"entry",
			[],
			[MIR.Constructors.Instr.Let("x", MIR.Constructors.Expr.Lit(Lit.Num(42)))],
			MIR.Constructors.Terminator.Return("x"),
		);
		expect(Pretty.display.block(block)).toMatchSnapshot();
	});

	it("display.function for lowerToMir(EB.DSL.num(42))", () => {
		const term = EB.DSL.num(42);
		const fn = lowerToMir(term);
		expect(Pretty.display.function(fn)).toMatchSnapshot();
	});

	it("display() handles all types", () => {
		const expr = MIR.Constructors.Expr.Lit(Lit.Num(1));
		expect(Pretty.display(expr)).toBe("1");

		const fn = lowerToMir(EB.DSL.add(EB.DSL.num(1), EB.DSL.num(2)));
		expect(Pretty.display(fn)).toMatchSnapshot();
	});

	it("display.module", () => {
		const fn = lowerToMir(EB.DSL.num(42));
		const mod = MIR.Constructors.Module([fn]);
		expect(Pretty.display.module(mod)).toMatchSnapshot();
	});
});
