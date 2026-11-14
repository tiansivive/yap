import { describe, expect, it } from "vitest";
import assert from "node:assert";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { declaration, elaborateModule, type Elaborated } from "../../__tests__/module";
import { runNF, shown } from "./util";

const elaborated = (source: string): Elaborated => {
	const module = elaborateModule(source);
	expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
	return declaration(module, "result")!.elaborated!;
};
const bare = (term: EB.Term): EB.Term => (term.type === "Ann" ? bare(term.term) : term);
const atom = (value: string) => ({ type: "Lit", value: { type: "Atom", value } });
const body = (term: EB.Term) => {
	const tm = bare(term);
	assert(tm.type === "Abs", "Expected a handler lambda");
	return tm.body;
};
const application = (term: EB.Term) => {
	const tm = bare(term);
	assert(tm.type === "App", "Expected a handler application");
	return tm;
};
const reset = (term: EB.Term) => {
	const tm = bare(term);
	assert(tm.type === "Reset", "Expected a handler delimiter");
	return tm;
};

const block = (term: EB.Term) => {
	const tm = bare(term);
	if (tm.type !== "Block") {
		throw new Error("Expected handler bindings");
	}
	return tm;
};

describe("Inference: with", () => {
	it("binds the identity and handler once and installs a recursive deep wrapper", () => {
		const result = elaborated("foreign Ask: Effect Unit Num; let result: Num = with Ask: (\\p k -> k 42) in suspend @Ask !;");
		const tm = block(result.tm);
		expect(tm.statements).toHaveLength(3);
		expect(tm.statements[0]).toMatchObject({ type: "Let", variable: "$identity", value: { type: "Var", variable: { type: "Foreign", name: "Ask" } } });
		expect(bare(tm.return)).toMatchObject({
			type: "Reset",
			handling: { identity: { type: "Var", variable: { type: "Bound", index: 2 } }, handler: { type: "Var", variable: { type: "Bound", index: 0 } } },
			term: { type: "Bubble", shift: { type: "Suspend" } },
		});
		const invocation = application(body(body(tm.statements[2].value)));
		expect(application(invocation.func).func).toMatchObject({ type: "Var", variable: { type: "Bound", index: 3 } });
		const continuation = reset(body(invocation.arg));
		expect(continuation.handling).toMatchObject({
			identity: { type: "Var", variable: { type: "Bound", index: 5 } },
			handler: { type: "Var", variable: { type: "Bound", index: 3 } },
		});
		expect(application(continuation.term)).toMatchObject({
			func: { type: "Var", variable: { type: "Bound", index: 1 } },
			arg: { type: "Var", variable: { type: "Bound", index: 0 } },
		});
		expect(shown(result.ctx, result.registry)(() => EB.Display.Term(result.tm))).toMatchSnapshot();
	});

	it("infers the answer from a handler and body", () => {
		const result = elaborated("foreign Ask: Effect Unit Num; let result = with Ask: (\\p k -> k 42) in suspend @Ask !;");
		expect(runNF(result.ctx, () => NF.quote(0, result.ty), result.registry)).toMatchObject(atom("Num"));
	});

	it("keeps the first clause outermost", () => {
		const result = elaborated(
			"foreign Ask: Effect Unit Num; foreign Tell: Effect Num Unit; let result: Num = with Ask: (\\p k -> k 42), Tell: (\\p k -> k !) in 7;",
		);
		const outer = block(result.tm);
		expect(outer.statements[0].value).toMatchObject({ type: "Var", variable: { type: "Foreign", name: "Ask" } });
		expect(block(reset(outer.return).term).statements[0].value).toMatchObject({ type: "Var", variable: { type: "Foreign", name: "Tell" } });
	});

	it("preserves an outer identity and handler closure through generated scopes", () => {
		const result = elaborated("let result = \\(e: Effect Unit Num) (n: Num) -> with e: (\\p k -> k n) in n;");
		const first = bare(result.tm);
		if (first.type !== "Abs") {
			throw new Error("Expected identity lambda");
		}
		const second = bare(first.body);
		if (second.type !== "Abs") {
			throw new Error("Expected number lambda");
		}
		const tm = block(second.body);
		expect(tm.statements[0].value).toMatchObject({ type: "Var", variable: { type: "Bound", index: 2 } });
		expect(application(body(body(tm.statements[1].value))).arg).toMatchObject({ type: "Var", variable: { type: "Bound", index: 4 } });
		expect(bare(tm.return)).toMatchObject({ type: "Reset", term: { type: "Var", variable: { type: "Bound", index: 3 } } });
	});

	it("forwards the implicit carrier argument through the polymorphic wrapper", () => {
		const result = elaborated("foreign Echo: (a: Type) => Effect a a; let result: Num = with Echo: (\\p k -> k p) in suspend @Echo 42;");
		const tm = block(result.tm);
		expect(tm.statements[1].value).toMatchObject({ type: "Abs", binding: { type: "Lambda", icit: "Implicit", annotation: atom("Type") } });
		expect(bare(tm.statements[2].value)).toMatchObject({ type: "Abs", binding: { icit: "Implicit" } });
		const invocation = application(body(body(body(tm.statements[2].value))));
		expect(application(application(invocation.func).func)).toMatchObject({ icit: "Implicit", arg: { type: "Var", variable: { type: "Bound", index: 2 } } });
		expect(shown(result.ctx, result.registry)(() => EB.Display.Term(result.tm))).toMatchSnapshot();
	});

	it("specializes a generalized handler alias before installing it", () => {
		const result = elaborated("foreign Ask: Effect Unit Num; let h = \\p k -> k 42; let result: Num = with Ask: h in 0;");
		const handler = application(block(result.tm).statements[1].value);
		expect(handler).toMatchObject({ icit: "Implicit", arg: atom("Num") });
		expect(application(handler.func)).toMatchObject({ icit: "Implicit", func: { type: "Var", variable: { type: "Free", name: "h" } }, arg: atom("Unit") });
	});

	it("evaluates a polymorphic handler factory before entering its implicit lambda", () => {
		const result = elaborated(
			"foreign Echo: (a: Type) => Effect a a; foreign make: Unit -> ((a: Type) => a -> (a -> Num) -> Num); let result: Num = with Echo: (make !) in 0;",
		);
		expect(bare(block(result.tm).statements[1].value)).toMatchObject({
			type: "App",
			icit: "Explicit",
			func: { type: "Var", variable: { type: "Foreign", name: "make" } },
		});
	});

	it.each([
		"foreign Ask: Effect Unit Num; let result: Num = with Ask: (\\p k -> k true) in 0;",
		"foreign Ask: Effect Unit Num; let result: Bool = with Ask: (\\p k -> 0) in true;",
		"foreign Echo: (a: Type) => Effect a a; let result: Num = with Echo: (\\p k -> k 0) in 0;",
		"let result: Num = with 1: (\\p k -> 0) in 0;",
	])("rejects an incompatible handler: %s", source => {
		expect(declaration(elaborateModule(source), "result")?.error).toBeDefined();
	});

	it("evaluates a normal return through a named handler", () => {
		const result = elaborated("foreign Ask: Effect Unit Num; let result: Num = with Ask: (\\p k -> k 42) in 0;");
		expect(runNF(result.ctx, () => NF.evaluate(result.tm), result.registry)).toMatchObject({ type: "Lit", value: { type: "Num", value: 0 } });
	});
});
