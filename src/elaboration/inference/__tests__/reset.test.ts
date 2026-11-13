import { describe, expect, it } from "vitest";
import { isMatching } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Eff from "@yap/utils/effects";
import { VerificationServiceV2 } from "@yap/verification/V2/service";
import { Validity } from "@yap/verification/validity";
import { declaration, elaborateModule, type Elaborated } from "../../__tests__/module";
import { mkCtx, parseExpr, runEB, runNF, shown } from "./util";

const elaborated = (source: string, name = "result"): Elaborated => {
	const module = elaborateModule(source);
	expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
	const result = declaration(module, name);
	if (!result?.elaborated) {
		throw new Error("Expected elaborated declaration");
	}
	return result.elaborated;
};
const bare = (term: EB.Term): EB.Term => (isMatching({ type: "Ann" }, term) ? bare(term.term) : term);
const explicit = (term: EB.Term): EB.Term => {
	const tm = bare(term);
	return isMatching({ type: "Abs", binding: { icit: "Implicit" } }, tm) ? explicit(tm.body) : tm;
};
const block = (term: EB.Term) => {
	const tm = bare(term);
	if (!isMatching({ type: "Block" }, tm)) {
		throw new Error("Expected named identity binding");
	}
	return tm;
};
const reset = (term: EB.Term) => {
	const tm = explicit(term);
	if (!isMatching({ type: "Reset" }, tm)) {
		throw new Error("Expected reset");
	}
	return tm;
};
const atom = (value: string) => ({ type: "Lit", value: { type: "Atom", value } });
const quoted = ({ ty, ctx, registry }: Elaborated) => runNF(ctx, () => NF.quote(0, ty), registry);

describe("Inference: raw reset", () => {
	it("installs a polymorphic application handler for the shared unnamed effect", () => {
		const result = elaborated("let result = reset 10;");
		const tm = reset(result.tm);
		expect(quoted(result)).toMatchObject(atom("Num"));
		expect(tm).toMatchObject({
			type: "Reset",
			handling: {
				identity: { type: "Ann", term: atom("$anonymous"), ann: { type: "Abs", binding: { type: "Pi", icit: "Implicit", annotation: atom("Type") } } },
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
		const result = elaborated('let result: String = reset ((suspend (\\k -> "hello")) : Num);');
		expect(quoted(result)).toMatchObject(atom("String"));
		const tm = reset(result.tm);
		expect(tm).toMatchObject({
			type: "Reset",
			term: {
				type: "Suspend",
				annotation: atom("Num"),
				payload: {
					type: "Abs",
					binding: { annotation: { type: "Abs", binding: { annotation: atom("Num") }, body: atom("Num") } },
				},
			},
		});
		expect(shown(result.ctx, result.registry)(() => EB.Display.Term(result.tm))).toMatchSnapshot();
	});

	it.each(["reset (suspend (\\k -> (k 10) + (k 20)))", "reset (suspend (\\k -> k (k 10)))"])("checks repeated resumption in %s", source => {
		const result = elaborated(`let result: Num = ${source};`);
		expect(quoted(result)).toMatchObject(atom("Num"));
	});

	it("chooses the result type separately at each suspension", () => {
		const result = elaborated("let result: Num = reset (match (suspend (\\k -> k true)) | true -> (suspend (\\k -> k 1)) | false -> 2);");
		expect(reset(result.tm)).toMatchObject({
			type: "Reset",
			term: {
				type: "Match",
				scrutinee: { type: "Suspend", annotation: atom("Bool") },
				alternatives: [{ term: { type: "Suspend", annotation: atom("Num") } }, { term: expect.any(Object) }],
			},
		});
	});

	it("preserves the shared marker through nested anonymous resets", () => {
		const result = elaborated("let result: Num = reset (reset (suspend (\\k -> k 1)));");
		const outer = reset(result.tm);
		expect(reset(outer.term)).toMatchObject({
			type: "Reset",
			term: {
				type: "Suspend",
				identity: { type: "Ann", term: atom("$anonymous"), ann: { type: "App", arg: atom("Num") } },
			},
		});
	});

	it("preserves anonymous suspension through a named delimiter", () => {
		const result = elaborated("foreign E: Effect ((Num -> Num) -> Num) Num; let result: Num = reset (reset @E (suspend (\\k -> k 1)));");
		const outer = reset(result.tm);
		expect(block(outer.term).return).toMatchObject({
			type: "Reset",
			term: {
				type: "Suspend",
				identity: { type: "Ann", term: atom("$anonymous") },
			},
		});
	});

	it.each([
		"match b | true -> (suspend (\\k -> k 1)) | false -> 2",
		"match b | true -> 2 | false -> (suspend (\\k -> k 1))",
		'match b | true -> ((suspend (\\k -> "one")) : Num) | false -> ((suspend (\\k -> "two")) : Num)',
	])("checks compatible branch answers in %s", source => {
		expect(elaborated(`let result = \\(b: Bool) -> reset (${source});`).tm).toBeDefined();
	});

	it.each([
		'match b | true -> (suspend (\\k -> "hello")) | false -> 1',
		'match b | true -> 1 | false -> (suspend (\\k -> "hello"))',
		'match b | true -> (suspend (\\k -> "hello")) | false -> (suspend (\\k -> true))',
		'match b | true -> (reset (suspend (\\k -> k 1))) | false -> (suspend (\\k -> "hello"))',
		'match b | true -> (suspend (\\k -> "hello")) | false -> (reset (suspend (\\k -> k 1)))',
	])("rejects conflicting branch answers in %s", source => {
		expect(declaration(elaborateModule(`let result = \\(b: Bool) -> reset (${source});`), "result")?.error).toMatch(
			/Cannot unify (Num with String|String with Num|String with Bool|Bool with String)/,
		);
	});

	it.each(['let result = reset (\\(u: Unit) -> suspend (\\k -> "hello"));', 'let result: Unit -> Num = reset (\\u -> suspend (\\k -> "hello"));'])(
		"keeps closure creation on the ordinary return path: %s",
		source => {
			expect(elaborated(source).tm).toBeDefined();
		},
	);

	it("preserves outer dependent references in anonymous operations", () => {
		const result = elaborated("let result = \\(a: Type) (x: a) -> reset (suspend (\\k -> k x));");
		const first = bare(result.tm);
		if (!isMatching({ type: "Abs" }, first)) {
			throw new Error("Expected type parameter");
		}
		const second = bare(first.body);
		if (!isMatching({ type: "Abs" }, second)) {
			throw new Error("Expected value parameter");
		}
		expect(reset(second.body)).toMatchObject({
			type: "Reset",
			term: {
				type: "Suspend",
				annotation: {
					type: "Var",
					variable: { type: "Bound", index: 1 },
				},
				payload: { type: "Abs", body: { type: "App", arg: { type: "Var", variable: { type: "Bound", index: 1 } } } },
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
			expect(reset(answer[0]).type).toBe("Reset");
		},
	);

	it("translates legacy shift through the shared unnamed effect", () => {
		const result = elaborated("let result: Num = reset (shift resume 1);");
		expect(reset(result.tm)).toMatchObject({
			type: "Reset",
			term: {
				type: "Bubble",
				shift: {
					type: "Suspend",
					identity: { type: "Ann", term: atom("$anonymous") },
					annotation: atom("Num"),
					payload: { type: "Abs" },
				},
			},
		});
	});

	it.each([
		"foreign E: Effect ((Num -> Num) -> Num) Num; let result: Num = reset @E (suspend @E (\\k -> k 2));",
		"foreign E: (r: Type) => Effect ((r -> Num) -> Num) r; let result: Num = reset @E 1;",
	])("checks the application handler against an explicit effect type: %s", source => {
		const result = elaborated(source);
		expect(block(result.tm).statements[0].value).toMatchObject({ type: "Var", variable: { type: "Foreign", name: "E" } });
		expect(quoted(result)).toMatchObject(atom("Num"));
	});

	it.each([
		"foreign E: Effect Unit Num; let result: Num = reset @E 1;",
		"foreign E: Effect ((Num -> Num) -> Bool) Num; let result: Num = reset @E 1;",
		"let result: Bool = reset (suspend (\\k -> k 1));",
	])("rejects incompatible control types: %s", source => {
		expect(declaration(elaborateModule(source), "result")?.error).toBeDefined();
	});

	it("preserves a guaranteed suspension through a later ordinary match", () => {
		const result = elaborated('let result: Bool -> String = \\b -> reset { (suspend (\\k -> "hello") : Unit); return match b | true -> 1 | false -> 2; };');
		expect(quoted(result)).toMatchObject({ type: "Abs", body: atom("String") });
	});

	// TODO: Keep inferred answer refinements scoped outside the captured continuation's binder.
	it.fails("keeps inferred repeated-resumption refinements closed", () => {
		const result = elaborated("let result = reset (suspend (\\k -> (k 10) + (k 20)));");
		const type = quoted(result);
		if (!isMatching({ type: "Modal" }, type)) {
			return;
		}
		EB.traverse(type.modalities.liquid, term => {
			if (!isMatching({ type: "Bound" }, term.variable)) {
				return term;
			}
			expect(term.variable.index).toBeGreaterThanOrEqual(0);
			return term;
		});
	});

	it("preserves a fixed answer through public legacy multishot replay", () => {
		const result = elaborated("let result: Num = reset (shift ((resume 10) + (resume 20)));");
		expect(quoted(result)).toMatchObject(atom("Num"));
	});

	it("elaborates standalone anonymous operations", () => {
		const result = elaborated("let result: Num = suspend (\\k -> (k 1 : Num));");
		expect(bare(result.tm)).toMatchObject({ type: "Suspend", identity: { type: "Ann", term: atom("$anonymous") }, annotation: atom("Num") });
	});

	it("keeps anonymous operations in separately defined functions", () => {
		const source = "let f = \\x -> suspend (\\k -> k (x + 1)); let result: Num = reset (f 1);";
		const fn = explicit(elaborated(source, "f").tm);
		expect(fn).toMatchObject({
			type: "Abs",
			binding: { type: "Lambda", icit: "Explicit", annotation: atom("Num") },
			body: { type: "Suspend", identity: { type: "Ann", term: atom("$anonymous") } },
		});
		const result = elaborated(source);
		expect(explicit(quoted(result))).toMatchObject(atom("Num"));
		expect(reset(result.tm).term).toMatchObject({ type: "App", func: { type: "App", func: { type: "Var", variable: { type: "Free", name: "f" } } } });
	});

	it("returns closures whose anonymous suspensions remain available at their call sites", () => {
		const source = "let g = reset (\\u -> suspend (\\k -> k 1)); let result: Num = reset (g !);";
		const closure = elaborated(source, "g");
		expect(explicit(quoted(closure))).toMatchObject({ type: "Abs", binding: { type: "Pi", icit: "Explicit" }, body: atom("Num") });
		expect(reset(closure.tm).term).toMatchObject({
			type: "Ann",
			term: { type: "Abs", body: { type: "Suspend", identity: { type: "Ann", term: atom("$anonymous") } } },
		});
		expect(explicit(quoted(elaborated(source)))).toMatchObject(atom("Num"));
	});

	it("keeps independent type instances on nested anonymous delimiters", () => {
		const result = elaborated('let result: Bool = reset { (reset ((suspend (\\k -> "inner")) : Num) : String); return true; };');
		const outer = reset(result.tm);
		expect(outer.handling?.identity).toMatchObject({
			type: "Ann",
			term: atom("$anonymous"),
			ann: { type: "Abs", body: { func: { arg: { body: atom("Bool") } } } },
		});
		const inner = block(outer.term).statements[0].value;
		expect(reset(inner).handling?.identity).toMatchObject({
			type: "Ann",
			term: atom("$anonymous"),
			ann: { type: "Abs", body: { func: { arg: { binding: { annotation: { body: atom("Num") } }, body: atom("String") } } } },
		});
	});

	it("preserves named suspensions across an anonymous delimiter", () => {
		const result = elaborated("foreign E: Effect ((Num -> Num) -> Num) Num; let result: Num = reset @E (reset (suspend @E (\\k -> k 1)));");
		const outer = reset(block(result.tm).return);
		expect(outer.handling?.identity).toMatchObject({ type: "Var", variable: { type: "Bound", index: 0 } });
		expect(reset(outer.term).term).toMatchObject({ type: "Suspend", identity: { type: "Var", variable: { type: "Foreign", name: "E" } } });
	});

	it("preserves anonymous suspensions inside a suspension payload", () => {
		const result = elaborated('let result: String = reset (reset (suspend (\\k -> suspend (\\outer -> "hello"))));');
		expect(reset(reset(result.tm).term).term).toMatchObject({
			type: "Suspend",
			identity: { type: "Ann", term: atom("$anonymous") },
			payload: { type: "Abs", body: { type: "Suspend", identity: { type: "Ann", term: atom("$anonymous") } } },
		});
	});

	it("retains incompatible call and handler answers for verification", () => {
		const source = 'let abort = \\u -> suspend (\\k -> "hello"); let result: Num = reset (abort !);';
		expect(explicit(elaborated(source, "abort").tm)).toMatchObject({
			type: "Abs",
			body: { type: "Suspend", identity: { type: "Ann", term: atom("$anonymous"), ann: { func: { arg: { body: atom("String") } } } } },
		});
		const { tm, ty, ctx, registry } = elaborated(source);
		expect(reset(tm).handling?.identity).toMatchObject({ type: "Ann", term: atom("$anonymous"), ann: { body: { func: { arg: { body: atom("Num") } } } } });
		expect(() => VerificationServiceV2().letdec("result", tm, ty, ctx, registry)).toThrow("Handler-bearing reset verification is pending");
	});

	// The verifier must check each anonymous operation against the delimiter selected at its call.
	it.fails.each([
		'let abort = \\u -> suspend (\\k -> "hello"); let result: Num = reset (abort !);',
		'let f: Unit -> Num = \\u -> suspend (\\k -> 1 + (k 0)); let result: String = reset { f !; return "ok"; };',
	])("rejects incompatible anonymous answer types during verification: %s", source => {
		const { tm, ty, ctx, registry } = elaborated(source);
		const { answer } = VerificationServiceV2().letdec("result", tm, ty, ctx, registry);
		expect(Eff.failed(answer) || Validity.check(answer.vc).tag === "invalid").toBe(true);
	});

	it("retains operation calls used as arithmetic arguments for suspended evaluation", () => {
		expect(() => elaborateModule("let f = \\x -> suspend (\\k -> k (x + 1)); let result: Num = reset (10 + (f 1));")).toThrow("Suspend evaluation is pending");
	});

	it("evaluates a normal return through the installed handler", () => {
		const result = elaborated("let result = reset 10;");
		expect(runNF(result.ctx, () => NF.evaluate(result.tm), result.registry)).toMatchObject({ type: "Lit", value: { type: "Num", value: 10 } });
	});

	it("retains captured application arguments for suspended evaluation", () => {
		expect(() => elaborateModule('let result: String = reset (1 + (suspend (\\k -> "hello")));')).toThrow("Suspend evaluation is pending");
	});
});
