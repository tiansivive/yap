import { describe, expect, it } from "vitest";
import * as EB from "@yap/elaboration";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Lit from "@yap/shared/literals";
import * as NF from "@yap/elaboration/normalization";
import { declaration, elaborateModule } from "../../__tests__/module";
import { runNF, mkCtx } from "../../inference/__tests__/util";

const program = (source: string, name = "result") => {
	const module = elaborateModule(source);
	expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
	return declaration(module, name)!.elaborated!;
};

describe("Suspended computations", () => {
	it("refreshes a deferred application after its function meta is solved", () => {
		const ctx = mkCtx();
		const meta = { type: "Meta", val: 500, lvl: 0 } as const;
		const source = { ctx, term: EB.Constructors.App("Explicit", EB.Constructors.Var(meta), EB.Constructors.Lit(Lit.Num(1))) };
		const value = NF.Constructors.Deferred(source);
		runNF(ctx, function* () {
			yield* Metas.registry.register({ meta, annotation: NF.Type });
			const first = yield* NF.force(value);
			expect(first.type).toBe("Computation");
			expect(yield* NF.force(value)).toBe(first);
			const func = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure(ctx, EB.Constructors.Lit(Lit.Num(42))), NF.Constructors.Atom("Num"));
			yield* Metas.registry.modify(registry => Metas.solve(registry, meta.val, func));
			expect(yield* NF.force(value)).toMatchObject({ type: "Lit", value: { type: "Num", value: 42 } });
		});
	});

	it.each([
		["foreign E: Effect Unit Num; let result: Num = with E: (\\p k -> k 42) in suspend @E !;", 42],
		["let f = \\x -> suspend (\\k -> k (x + 1)); let result: Num = reset (10 + (f 1));", 12],
		["foreign E: Effect Num Unit; let result: Num = with E: (\\p k -> p + (k !)) in { suspend @E 1; suspend @E 2; return 0; };", 3],
		["foreign Echo: (a: Type) => Effect a a; let result: Num = with Echo: (\\p k -> k p) in suspend @Echo 42;", 42],
	])("evaluates %s", (source, expected) => {
		const { ctx, tm, registry } = program(source);
		const got = NF.unglue(runNF(ctx, () => NF.evaluate(tm), registry));

		expect(got).toMatchObject({ type: "Lit", value: { type: "Num", value: expected } });
	});
	it("retains an aborting anonymous operation in an application argument", () => {
		const { ctx, tm, registry } = program('let result: String = reset (1 + (suspend (\\k -> "hello")));');
		expect(NF.unglue(runNF(ctx, () => NF.evaluate(tm), registry))).toMatchObject({ type: "Lit", value: { type: "String", value: "hello" } });
	});
	it.each([
		[
			"foreign E: Effect Num Num; let program: (Unit -> Num) -> Num = \\f -> with E: (\\p k -> p) in (\\(ignored: Num) -> 99) (f !); let callback: Unit -> Num = \\u -> suspend @E 7;",
			7,
		],
		[
			"foreign E: Effect Unit Num; let program: (Unit -> Num) -> Num = \\f -> with E: (\\p k -> 1 + (k 10)) in { let x = f !; return x + x; }; let callback: Unit -> Num = \\u -> suspend @E !;",
			21,
		],
		[
			"foreign E: Effect Unit Num; let program: (Num -> Num) -> Num = \\f -> with E: (\\p k -> (k 10) + (k 20)) in 100 + (f (suspend @E !)); let callback: Num -> Num = \\x -> x * 2;",
			260,
		],
	])("preserves callbacks through repeated readback: %s", (source, expected) => {
		const module = elaborateModule(source);
		expect(module.declarations.map(d => d.error)).toEqual(module.declarations.map(() => undefined));
		const main = declaration(module, "program")!.elaborated!;
		const callback = declaration(module, "callback")!.elaborated!;
		const result = runNF(
			callback.ctx,
			function* () {
				const arg = yield* NF.evaluate(callback.tm);
				const initial = yield* NF.evaluate(main.tm);
				const direct = yield* NF.reduce(initial, arg, "Explicit");
				expect(NF.unglue(direct)).toMatchObject({ type: "Lit", value: { type: "Num", value: expected } });
				const first = yield* NF.evaluate(yield* NF.quote(0, initial));
				const second = yield* NF.evaluate(yield* NF.quote(0, first));
				return [direct, yield* NF.reduce(second, arg, "Explicit")];
			},
			callback.registry,
		);
		expect(result.map(NF.unglue)).toMatchObject([
			{ type: "Lit", value: { type: "Num", value: expected } },
			{ type: "Lit", value: { type: "Num", value: expected } },
		]);
	});
});
