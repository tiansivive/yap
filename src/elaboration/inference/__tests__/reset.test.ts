import { describe, expect, it } from "vitest";
import { isMatching } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Eff from "@yap/utils/effects";
import { declaration, elaborateModule, type Elaborated } from "../../__tests__/module";
import { mkCtx, parseExpr, runEB, runNF, shown } from "./util";

const elaborated = (source: string): Elaborated => {
	const module = elaborateModule(source);
	expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
	const result = declaration(module, "result");
	if (!result?.elaborated) {
		throw new Error("Expected result declaration");
	}
	return result.elaborated;
};
const bare = (term: EB.Term): EB.Term => (isMatching({ type: "Ann" }, term) ? bare(term.term) : term);
const block = (term: EB.Term) => {
	const tm = bare(term);
	if (!isMatching({ type: "Block" }, tm)) {
		throw new Error("Expected hidden identity binding");
	}
	return tm;
};
const atom = (value: string) => ({ type: "Lit", value: { type: "Atom", value } });
const quoted = ({ ty, ctx, registry }: Elaborated) => runNF(ctx, () => NF.quote(0, ty), registry);

describe("Inference: raw reset", () => {
	it("allocates a hidden identity and installs a polymorphic application handler", () => {
		const result = elaborated("let result = reset 10;");
		const tm = block(result.tm);
		expect(quoted(result)).toMatchObject(atom("Num"));
		expect(tm.statements).toHaveLength(1);
		expect(tm.statements[0]).toMatchObject({
			type: "Let",
			variable: "$identity",
			value: {
				type: "Identity",
				annotation: { type: "Abs", binding: { type: "Pi", icit: "Implicit", annotation: atom("Type") } },
			},
		});
		expect(tm.return).toMatchObject({
			type: "Reset",
			handling: {
				identity: { type: "Var", variable: { type: "Bound", index: 0 } },
				handler: {
					type: "Abs",
					binding: { icit: "Implicit" },
					body: {
						type: "Abs",
						body: {
							type: "Abs",
							body: {
								type: "App",
								func: { type: "Var", variable: { type: "Bound", index: 1 } },
								arg: { type: "Var", variable: { type: "Bound", index: 0 } },
							},
						},
					},
				},
			},
		});
		expect(shown(result.ctx, result.registry)(() => EB.Display.Term(result.tm))).toMatchSnapshot();
	});

	it("keeps the body answer distinct from the handled answer", () => {
		const result = elaborated('let result: String = reset ((capture (\\k -> "hello")) : Num);');
		expect(quoted(result)).toMatchObject(atom("String"));
		const tm = block(result.tm);
		expect(tm.return).toMatchObject({
			type: "Reset",
			term: {
				type: "Capture",
				annotation: atom("Num"),
				payload: {
					type: "Abs",
					binding: { annotation: { type: "Abs", binding: { annotation: atom("Num") }, body: atom("Num") } },
				},
			},
		});
		expect(shown(result.ctx, result.registry)(() => EB.Display.Term(result.tm))).toMatchSnapshot();
	});

	it.each(["reset (capture (\\k -> (k 10) + (k 20)))", "reset (capture (\\k -> k (k 10)))"])("checks repeated resumption in %s", source => {
		const result = elaborated(`let result: Num = ${source};`);
		expect(quoted(result)).toMatchObject(atom("Num"));
	});

	it("chooses the result type separately at each capture", () => {
		const result = elaborated("let result: Num = reset (match (capture (\\k -> k true)) | true -> (capture (\\k -> k 1)) | false -> 2);");
		expect(block(result.tm).return).toMatchObject({
			type: "Reset",
			term: {
				type: "Match",
				scrutinee: { type: "Capture", annotation: atom("Bool") },
				alternatives: [{ term: { type: "Capture", annotation: atom("Num") } }, { term: expect.any(Object) }],
			},
		});
	});

	it("binds nested anonymous captures to the nearest reset", () => {
		const result = elaborated("let result: Num = reset (reset (capture (\\k -> k 1)));");
		const outer = block(result.tm);
		if (!isMatching({ type: "Reset" }, outer.return)) {
			throw new Error("Expected outer reset");
		}
		expect(block(outer.return.term).return).toMatchObject({
			type: "Reset",
			term: {
				type: "Capture",
				identity: { type: "App", func: { type: "Var", variable: { type: "Bound", index: 0 } }, arg: atom("Num") },
			},
		});
	});

	it("keeps anonymous capture attached to its reset across an explicit delimiter", () => {
		const result = elaborated("foreign E: Effect ((Num -> Num) -> Num) Num; let result: Num = reset (reset [E] (capture (\\k -> k 1)));");
		const outer = block(result.tm);
		if (!isMatching({ type: "Reset" }, outer.return)) {
			throw new Error("Expected outer reset");
		}
		expect(block(outer.return.term).return).toMatchObject({
			type: "Reset",
			term: {
				type: "Capture",
				identity: { type: "App", func: { type: "Var", variable: { type: "Bound", index: 1 } } },
			},
		});
	});

	it.each([
		"match b | true -> (capture (\\k -> k 1)) | false -> 2",
		"match b | true -> 2 | false -> (capture (\\k -> k 1))",
		'match b | true -> ((capture (\\k -> "one")) : Num) | false -> ((capture (\\k -> "two")) : Num)',
	])("checks compatible branch answers in %s", source => {
		expect(elaborated(`let result = \\(b: Bool) -> reset (${source});`).tm).toBeDefined();
	});

	it.each([
		'match b | true -> (capture (\\k -> "hello")) | false -> 1',
		'match b | true -> 1 | false -> (capture (\\k -> "hello"))',
		'match b | true -> (capture (\\k -> "hello")) | false -> (capture (\\k -> true))',
	])("rejects conflicting branch answers in %s", source => {
		expect(declaration(elaborateModule(`let result = \\(b: Bool) -> reset (${source});`), "result")?.error).toMatch(
			/Cannot unify (Num with String|String with Num|String with Bool|Bool with String)/,
		);
	});

	it.each([
		'let result = reset (\\(u: Unit) -> capture (\\k -> "hello"));',
		'let result: Unit -> Num = reset (\\u -> capture (\\k -> "hello"));',
		'let result: (a: Type) => Unit -> Num = reset (\\u -> capture (\\k -> "hello"));',
	])("keeps closure creation on the ordinary return path: %s", source => {
		expect(declaration(elaborateModule(source), "result")?.error).toBeDefined();
	});

	it("preserves outer dependent references through the hidden binding", () => {
		const result = elaborated("let result = \\(a: Type) (x: a) -> reset (capture (\\k -> k x));");
		const first = bare(result.tm);
		if (!isMatching({ type: "Abs" }, first)) {
			throw new Error("Expected type parameter");
		}
		const second = bare(first.body);
		if (!isMatching({ type: "Abs" }, second)) {
			throw new Error("Expected value parameter");
		}
		expect(block(second.body).return).toMatchObject({
			type: "Reset",
			term: {
				type: "Capture",
				annotation: {
					type: "Var",
					variable: { type: "Bound", index: 2 },
				},
				payload: { type: "Abs", body: { type: "App", arg: { type: "Var", variable: { type: "Bound", index: 2 } } } },
			},
		});
	});

	it.each(["reset (shift ((resume 10) + (resume 20)))", "reset (1 + (shift ((resume 10) + (resume 20))))"])(
		"solves legacy resumption constraints in %s",
		source => {
			const ctx = mkCtx();
			const { answer } = runEB(ctx, function* () {
				const [[term, type], { constraints }] = yield* M.writer.listen(EB.infer(parseExpr(`(${source} : Num)`)));
				const { resolutions } = yield* EB.solve(constraints);
				return [yield* EB.Icit.instantiate(term, resolutions), yield* NF.quote(ctx.env.length, type)] as const;
			});
			if (Eff.failed(answer)) {
				throw new Error("Expected compatible continuation calls");
			}
			expect(answer[1]).toMatchObject(atom("Num"));
			expect(block(answer[0]).return.type).toBe("Reset");
		},
	);

	it("translates legacy shift through the hidden identity", () => {
		const result = elaborated("let result: Num = reset (shift resume 1);");
		expect(block(result.tm).return).toMatchObject({
			type: "Reset",
			term: {
				type: "Bubble",
				shift: {
					type: "Capture",
					identity: { type: "App", icit: "Implicit" },
					annotation: atom("Num"),
					payload: { type: "Abs" },
				},
			},
		});
	});

	it.each([
		"foreign E: Effect ((Num -> Num) -> Num) Num; let result: Num = reset [E] (capture [E] (\\k -> k 2));",
		"foreign E: (r: Type) => Effect ((r -> Num) -> Num) r; let result: Num = reset [E] 1;",
	])("checks the application handler against an explicit carrier: %s", source => {
		const result = elaborated(source);
		expect(block(result.tm).statements[0].value).toMatchObject({ type: "Var", variable: { type: "Foreign", name: "E" } });
		expect(quoted(result)).toMatchObject(atom("Num"));
	});

	it.each([
		"foreign E: Effect Unit Num; let result: Num = reset [E] 1;",
		"foreign E: Effect ((Num -> Num) -> Bool) Num; let result: Num = reset [E] 1;",
		"let result: Bool = reset (capture (\\k -> k 1));",
	])("rejects incompatible control types: %s", source => {
		expect(declaration(elaborateModule(source), "result")?.error).toBeDefined();
	});

	it("preserves a guaranteed capture through a later ordinary match", () => {
		const result = elaborated('let result: Bool -> String = \\b -> reset { (capture (\\k -> "hello") : Unit); return match b | true -> 1 | false -> 2; };');
		expect(quoted(result)).toMatchObject({ type: "Abs", body: atom("String") });
	});

	// TODO: Keep inferred answer refinements scoped outside the captured continuation's binder.
	it.fails("keeps inferred repeated-resumption refinements closed", () => {
		const result = elaborated("let result = reset (capture (\\k -> (k 10) + (k 20)));");
		const type = quoted(result);
		if (isMatching({ type: "Modal" }, type)) {
			EB.traverse(type.modalities.liquid, term => {
				if (isMatching({ type: "Bound" }, term.variable)) {
					expect(term.variable.index).toBeGreaterThanOrEqual(0);
				}
				return term;
			});
		}
	});

	it("preserves a fixed answer through public legacy multishot replay", () => {
		const result = elaborated("let result: Num = reset (shift ((resume 10) + (resume 20)));");
		expect(quoted(result)).toMatchObject(atom("Num"));
	});

	it("requires a lexical anonymous reset", () => {
		expect(() => elaborateModule("let result = capture (\\k -> k 1);")).toThrow("capture without an enclosing reset");
	});

	it("retains fresh allocation for evaluation", () => {
		const result = elaborated("let result = reset 10;");
		expect(() => runNF(result.ctx, () => NF.evaluate(result.tm), result.registry)).toThrow("Fresh identity evaluation is pending");
	});

	it("retains captured application arguments for suspended evaluation", () => {
		expect(() => elaborateModule('let result: String = reset (1 + (capture (\\k -> "hello")));')).toThrow("Capture evaluation is pending");
	});
});
