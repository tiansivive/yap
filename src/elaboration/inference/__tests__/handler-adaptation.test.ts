import { describe, expect, it, vi } from "vitest";
import { isMatching } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import { declaration, elaborateModule, type Elaborated } from "../../__tests__/module";
import { runNF } from "./util";

const elaborated = (source: string): Elaborated => {
	const module = elaborateModule(source);
	expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
	return declaration(module, "result")!.elaborated!;
};

const block = (term: EB.Term): EB.Term & { type: "Block" } => {
	if (isMatching({ type: "Ann" }, term)) {
		return block(term.term);
	}
	if (!isMatching({ type: "Block" }, term)) {
		throw new Error("Expected handler installation");
	}
	return term;
};

const atom = (value: string) => ({ type: "Lit", value: { type: "Atom", value } });

describe("Handler adaptation", () => {
	it("specializes a generalized alias under the carrier parameter", () => {
		const result = elaborated("foreign Echo: (a: Type) => Effect a a; let h = \\p k -> k p; let result: Num = with Echo: h in 0;");
		const installation = block(result.tm);
		expect(installation.statements).toHaveLength(4);
		expect(installation.statements[1].value).toMatchObject({ type: "Var", variable: { type: "Free", name: "h" } });
		expect(installation.statements[2].value).toMatchObject({
			type: "Abs",
			binding: { type: "Lambda", icit: "Implicit", annotation: atom("Type") },
			body: {
				type: "App",
				icit: "Implicit",
				arg: atom("Num"),
				func: { type: "App", icit: "Implicit", arg: { type: "Var", variable: { type: "Bound", index: 0 } } },
			},
		});
	});

	it("retains the expected phantom carrier binder while specializing a more general alias", () => {
		const result = elaborated("foreign Tick: (a: Type) => Effect Unit Unit; let h = \\p k -> k p; let result: Num = with Tick: h in 0;");
		const installation = block(result.tm);
		expect(installation.statements[2].value).toMatchObject({
			type: "Abs",
			binding: { type: "Lambda", icit: "Implicit", annotation: atom("Type") },
			body: { type: "App", icit: "Implicit", arg: atom("Num"), func: { type: "App", icit: "Implicit", arg: atom("Unit") } },
		});
	});

	it("retains dependent carrier parameters through alias adaptation", () => {
		const result = elaborated("foreign Echo: (a: Type) => (x: a) => Effect a a; let h = \\p k -> k p; let result: Num = with Echo: h in 0;");
		const installation = block(result.tm);
		expect(installation.statements[2].value).toMatchObject({
			type: "Abs",
			binding: { type: "Lambda", icit: "Implicit", annotation: atom("Type") },
			body: {
				type: "Abs",
				binding: { type: "Lambda", icit: "Implicit", annotation: { type: "Var", variable: { type: "Bound", index: 0 } } },
				body: { type: "App", arg: atom("Num"), func: { type: "App", arg: { type: "Var", variable: { type: "Bound", index: 1 } } } },
			},
		});
	});

	it("preserves an already matching phantom handler scheme", () => {
		const result = elaborated(
			"foreign Tick: (a: Type) => Effect Unit Unit; foreign h: (a: Type) => Unit -> (Unit -> Num) -> Num; let result: Num = with Tick: h in 0;",
		);
		const installation = block(result.tm);
		expect(installation.statements).toHaveLength(3);
		expect(installation.statements[1].value).toMatchObject({ type: "Var", variable: { type: "Foreign", name: "h" } });
		const invoke = vi.fn((_type: NF.Value, _payload: NF.Value, _resume: NF.Value) => NF.Constructors.Lit({ type: "Num", value: 42 }));
		const ctx = { ...result.ctx, ffi: { ...result.ctx.ffi, h: { arity: 3, compute: invoke } } };
		const value = runNF(
			ctx,
			function* () {
				const installed = yield* NF.evaluate(EB.Constructors.Block(installation.statements, EB.Constructors.Var({ type: "Bound", index: 0 })));
				const specialized = yield* NF.reduce(installed, NF.Constructors.Atom("Num"), "Implicit");
				const handled = yield* NF.reduce(specialized, NF.Constructors.Lit({ type: "unit" }), "Explicit");
				const resume = yield* NF.evaluate(
					EB.Constructors.Lambda("x", "Explicit", EB.Constructors.Lit({ type: "Num", value: 0 }), EB.Constructors.Lit({ type: "Atom", value: "Unit" })),
				);
				return yield* NF.reduce(handled, resume, "Explicit");
			},
			result.registry,
		);
		expect(value).toMatchObject({ type: "Lit", value: { type: "Num", value: 42 } });
		expect(invoke).toHaveBeenCalledOnce();
		expect(invoke.mock.calls[0][0]).toMatchObject(atom("Num"));
	});

	it("evaluates each initializer once before supplying handler type arguments", () => {
		const result = elaborated(
			"foreign Echo: (a: Type) => Effect a a; foreign makeId: Unit -> ((a: Type) => Effect a a); foreign make: Unit -> ((a: Type) => (b: Type) => a -> (a -> b) -> b); let h = \\p k -> k p; let result: Num = with (makeId !): (make !) in 0;",
		);
		const installation = block(result.tm);
		const original = runNF(result.ctx, () => NF.evaluate(EB.Constructors.Var({ type: "Free", name: "h" })), result.registry);
		const identity = runNF(result.ctx, () => NF.evaluate(EB.Constructors.Var({ type: "Foreign", name: "Echo" })), result.registry);
		const initializer = vi.fn<(name: string) => void>();
		const ctx = {
			...result.ctx,
			ffi: {
				...result.ctx.ffi,
				makeId: {
					arity: 1,
					compute: () => {
						initializer("identity");
						return identity;
					},
				},
				make: {
					arity: 1,
					compute: () => {
						initializer("handler");
						return original;
					},
				},
			},
		};
		const prefix = EB.Constructors.Block(installation.statements.slice(0, -1), EB.Constructors.Var({ type: "Bound", index: 0 }));
		const handler = runNF(ctx, () => NF.evaluate(prefix), result.registry);
		expect(initializer.mock.calls).toEqual([["identity"], ["handler"]]);
		const first = runNF(ctx, () => NF.reduce(handler, NF.Constructors.Atom("Num"), "Implicit"), result.registry);
		const second = runNF(ctx, () => NF.reduce(handler, NF.Constructors.Atom("Bool"), "Implicit"), result.registry);
		expect(runNF(ctx, () => NF.view(first), result.registry).value).toMatchObject({ type: "Abs", binder: { type: "Lambda" } });
		expect(runNF(ctx, () => NF.view(second), result.registry).value).toMatchObject({ type: "Abs", binder: { type: "Lambda" } });
		expect(initializer.mock.calls).toEqual([["identity"], ["handler"]]);
	});

	it("rejects an alias whose result disagrees with the installation answer", () => {
		const result = elaborateModule("foreign Echo: (a: Type) => Effect a a; let h = \\p k -> true; let result: Num = with Echo: h in 0;");
		expect(declaration(result, "result")?.error).toBeDefined();
	});
});
