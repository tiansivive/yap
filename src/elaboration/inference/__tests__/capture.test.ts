import { describe, expect, it } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Eff from "@yap/utils/effects";

import { declaration, elaborateModule, type Elaborated } from "../../__tests__/module";
import { mkCtx, parseExpr, runEB, runNF, shown } from "./util";

const elaborated = (source: string, name = "op"): Elaborated => {
	const module = elaborateModule(source);
	expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
	return declaration(module, name)!.elaborated!;
};

const quoted = ({ ty, ctx, registry }: Elaborated) => runNF(ctx, () => NF.quote(0, ty), registry);
const bare = (tm: EB.Term): EB.Term => (tm.type === "Ann" ? bare(tm.term) : tm);
const atom = (value: string) => ({ type: "Lit", value: { type: "Atom", value } });

describe("Inference: capture", () => {
	it("gives Effect two type arguments", () => {
		const ctx = mkCtx();
		const { answer } = runEB(ctx, () => EB.infer(parseExpr("Effect Unit Num")));
		expect(Eff.failed(answer)).toBe(false);
		if (Eff.failed(answer)) {
			throw new Error("Expected carrier type");
		}
		expect(answer[1]).toMatchObject(atom("Type"));
	});

	it("retains a shared foreign identity, checked payload and result type", () => {
		const result = elaborated("foreign Ask: Effect Unit Num; let op = capture @Ask !;");
		expect(result.tm).toMatchObject({
			type: "Capture",
			identity: { type: "Var", variable: { type: "Foreign", name: "Ask" } },
			payload: { type: "Lit", value: { type: "unit" } },
			annotation: atom("Num"),
		});
		expect(quoted(result)).toMatchObject(atom("Num"));
	});

	it("groups a capture used as an application argument", () => {
		const result = elaborated("foreign Ask: Effect Unit Num; let op = capture @Ask !;");
		const application = EB.Constructors.App("Explicit", EB.Constructors.Var({ type: "Free", name: "f" }), result.tm);
		expect(shown(result.ctx, result.registry)(() => EB.Display.Term(application))).toMatchSnapshot();
	});

	it("retains the identity parameter through an ordinary binder", () => {
		const result = elaborated("let op = \\(e: Effect Unit Num) -> capture @e !;");
		expect(bare(result.tm)).toMatchObject({
			type: "Abs",
			body: { type: "Capture", identity: { type: "Var", variable: { type: "Bound", index: 0 } }, annotation: atom("Num") },
		});
		const tm = bare(result.tm);
		if (tm.type !== "Abs" || tm.body.type !== "Capture") {
			throw new Error("Expected capture under lambda");
		}
		const identity = NF.Constructors.Var({ type: "Foreign", name: "Supplied" });
		const ctx = EB.extend(result.ctx, tm.binding, identity);
		const capture = tm.body;
		const value = runNF(ctx, () => NF.evaluate(capture.identity), result.registry);
		expect(value).toBe(identity);
	});

	it("retains dependent payload and result types", () => {
		const result = elaborated("let op = \\(a: Type) (e: Effect a a) (x: a) -> capture @e x;");
		const captures = (tm: EB.Term): EB.Term => {
			const term = bare(tm);
			return term.type === "Abs" ? captures(term.body) : term;
		};
		expect(captures(result.tm)).toMatchObject({
			type: "Capture",
			identity: { type: "Var", variable: { type: "Bound", index: 1 } },
			payload: { type: "Var", variable: { type: "Bound", index: 0 } },
			annotation: { type: "Var", variable: { type: "Bound", index: 2 } },
		});
	});

	it("instantiates polymorphic carrier parameters independently at each capture", () => {
		const module = elaborateModule("foreign Echo: (a: Type) => Effect a a; let n: Num = capture @Echo 1; let b: Bool = capture @Echo true;");
		expect(module.declarations.map(d => d.error)).toEqual([undefined, undefined, undefined]);
		[
			["n", "Num"],
			["b", "Bool"],
		].forEach(([name, type]) => {
			const result = declaration(module, name)!.elaborated!;
			expect(result.tm).toMatchObject({
				type: "Capture",
				annotation: atom(type),
				identity: {
					type: "App",
					icit: "Implicit",
					func: { type: "Var", variable: { type: "Foreign", name: "Echo" } },
					arg: atom(type),
				},
			});
			if (result.tm.type !== "Capture") {
				throw new Error("Expected capture");
			}
			const capture = result.tm;
			const value = runNF(result.ctx, () => NF.evaluate(capture.identity), result.registry);
			expect(NF.unglue(value)).toMatchObject({ type: "Neutral", value: { type: "External", name: "Echo", args: [atom(type)] } });
		});
	});

	it.each(["\\(a: Type) => Ask", "Identity"])("applies the implicit parameters of %s", identity => {
		const declarations = elaborated("foreign Ask: Effect Unit Num; let Identity: (a: Type) => Effect Unit Num = \\a => Ask; let op: Effect Unit Num = Ask;");
		const { answer, registry } = runEB(declarations.ctx, () => EB.infer(parseExpr(`capture @(${identity}) !`)), declarations.registry);
		expect(Eff.failed(answer)).toBe(false);
		if (Eff.failed(answer) || answer[0].type !== "Capture") {
			throw new Error("Expected capture");
		}
		const capture = answer[0];
		expect(capture.identity).toMatchObject({ type: "App", icit: "Implicit" });
		const value = runNF(declarations.ctx, () => NF.evaluate(capture.identity), registry);
		expect(NF.unglue(value)).toMatchObject({ type: "Neutral", value: { type: "External", name: "Ask", args: [] } });
	});

	it("infers an unknown carrier from the capture payload", () => {
		const result = elaborated("let op = \\e -> capture @e !;");
		expect(quoted(result)).toMatchObject({
			type: "Abs",
			binding: { type: "Pi", icit: "Implicit", annotation: atom("Type") },
			body: { type: "Abs", binding: { type: "Pi", annotation: { type: "App", func: { type: "App", func: atom("Effect"), arg: atom("Unit") } } } },
		});
		expect(shown(result.ctx, result.registry)(() => EB.Display.Term(result.tm))).toMatchSnapshot();
	});

	it.each(["Alias", "record.Ask"])("preserves the value of %s", identity => {
		const result = elaborated(`foreign Ask: Effect Unit Num; let Alias = Ask; let record = { Ask: Ask }; let op = capture @(${identity}) !;`);
		if (result.tm.type !== "Capture") {
			throw new Error("Expected capture");
		}
		const capture = result.tm;
		const value = runNF(result.ctx, () => NF.evaluate(capture.identity), result.registry);
		expect(NF.unglue(value)).toMatchObject({ type: "Neutral", value: { type: "External", name: "Ask", args: [] } });
	});

	it("generalizes result-polymorphic carriers into operation functions", () => {
		const result = elaborated('foreign Abort: (a: Type) => Effect String a; let op = \\u -> capture @Abort "stop";');
		expect(quoted(result)).toMatchObject({ type: "Abs", binding: { type: "Pi", icit: "Implicit" } });
		expect(shown(result.ctx, result.registry)(() => EB.Display.Term(result.tm))).toMatchSnapshot();
	});

	it.each([
		["foreign Ask: Effect Unit Num; let op = capture @Ask 1;", "Unit"],
		["foreign Ask: Effect Unit Num; let op: Bool = capture @Ask !;", "Bool"],
		["let op = capture @1 !;", "Effect"],
	])("rejects an incompatible capture: %s", (source, expected) => {
		const module = elaborateModule(source);
		expect(declaration(module, "op")?.error).toContain(expected);
	});
});
