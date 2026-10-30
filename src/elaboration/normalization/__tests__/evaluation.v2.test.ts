import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as Lit from "@yap/shared/literals";

import { elaborateFrom, mkCtx, runNF, shown } from "../../inference/__tests__/util";
import * as Metas from "@yap/elaboration/shared/metas";

const ctxFor = (base = mkCtx()) => base;

const show = (v: NF.Value, ctx: EB.Context, registry: Metas.Registry = {}) => shown(ctx, registry)(() => NF.display(v));

describe("Normalization v2 (stack-based): evaluation / reduce / matching", () => {
	it("evaluates literals and arithmetic to WHNF", () => {
		const { structure } = elaborateFrom("1 + 2");
		const ctx = ctxFor(mkCtx());

		const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);

		// WHNF check: should be a literal after computing FFI op
		expect(nf.type).toBe("Lit");
		expect(show(nf, ctx)).toBe("3");
	});

	it("evaluates lambda application via reduce to WHNF", () => {
		const { structure } = elaborateFrom("(\\x -> x) 1");
		const ctx = ctxFor(mkCtx());

		const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
		expect(nf.type).toBe("Lit");
		expect(show(nf, ctx)).toBe("1");
	});

	it("evaluates rows + projection", () => {
		const { structure } = elaborateFrom("{ x: 1, y: 2 }.x");
		const ctx = ctxFor(mkCtx());

		const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
		expect(nf.type).toBe("Lit");
		expect(show(nf, ctx)).toBe("1");
	});

	it("pattern matches on a struct", () => {
		const src = ["match { a: 1, b: 2}", "  | { a: x, b: y } -> x", "  | _ -> 0"].join("\n");
		const { structure } = elaborateFrom(src);
		const ctx = ctxFor(mkCtx());

		const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
		expect(nf.type).toBe("Lit");
		expect(show(nf, ctx)).toBe("1");
	});

	it("evaluates dependent record projection", () => {
		const src = "{ x: 1, y: $x + 1 }.y";
		const { structure } = elaborateFrom(src);
		const ctx = ctxFor(mkCtx());

		const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
		expect(nf.type).toBe("Lit");
		expect(show(nf, ctx)).toBe("2");
	});

	it("observes nested Nu fields through projection", () => {
		const { structure } = elaborateFrom("{ q: { c: 2 } }.q.c");
		const ctx = ctxFor(mkCtx());

		const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
		expect(show(nf, ctx)).toBe("2");
	});

	it("rejects strict record cycles at elaboration", () => {
		expect(() => elaborateFrom("{ a: $a }.a")).toThrow("Record Cycle");
		expect(() => elaborateFrom("{ a: $b, b: $a }.a")).toThrow("Record Cycle");
	});

	/* No syntax builds a lazy record yet, so the term is written by hand. */
	describe("lazy records", () => {
		const a = (value: EB.Term) => R.Constructors.Extension("a", value, R.Constructors.Empty<EB.Term, EB.Variable>());
		const types = EB.Constructors.Row(R.Constructors.Empty<EB.Term, EB.Variable>());
		const lazy = (value: EB.Term) => EB.Constructors.Nu({ mode: "lazy", labels: ["a"], scoped: a(value), annotation: types }, EB.Constructors.Struct(a(value)));
		const normalize = (term: EB.Term) => runNF(ctxFor(mkCtx()), () => NF.normalize(term, { maxSteps: 2_000 }));

		it("stays a value until observed", () => {
			expect(normalize(lazy(EB.DSL.Labels.nu("a")))).toMatchObject({ type: "Abs", binder: { type: "Nu", mode: "lazy" } });
		});

		it("observes a field under its frame", () => {
			const record = EB.Constructors.Nu(
				{
					mode: "lazy",
					labels: ["a", "b"],
					scoped: R.Constructors.Extension("b", EB.Constructors.Lit({ type: "Num", value: 2 }), a(EB.DSL.Labels.nu("b"))),
					annotation: types,
				},
				EB.Constructors.Struct(R.Constructors.Extension("b", EB.Constructors.Lit({ type: "Num", value: 2 }), a(EB.DSL.Labels.nu("b")))),
			);
			expect(show(normalize(EB.Constructors.Proj("a", record)), mkCtx())).toBe("2");
		});

		it("keeps a cycle inert until observation", () => {
			expect(() => normalize(EB.Constructors.Proj("a", lazy(EB.DSL.Labels.nu("a"))))).toThrow("exceeded maximum steps");
		});
	});

	/*
	 * A `using` value is evaluated in a drive of its own. Its steps are the machine's, so a
	 * budget the surrounding block alone stays well under is still exhausted by the work
	 * inside — the counter cannot restart per drive, or a cycle spread across nested drives
	 * never reaches the cap and the host stack gives out first.
	 */
	describe("the step budget spans nested drives", () => {
		const fields = Array.from({ length: 30 }, (_, i) => `f${i}: ${i} + ${i}`).join(", ");
		const normalize = (src: string, maxSteps: number) => {
			const { structure } = elaborateFrom(src);

			return runNF(ctxFor(mkCtx()), () => NF.normalize(structure.term, { maxSteps }), structure.metas);
		};

		it("charges a nested drive's steps to the budget", () => {
			const src = `{
			using { ${fields} };
			return 1;
		}`;

			expect(() => normalize(src, 8)).toThrow(/exceeded maximum steps \(8\)/);
		});

		it("leaves a block that fits the budget alone", () => {
			expect(normalize("{ return 1; }", 8)).toMatchObject({ type: "Lit" });
		});
	});

	// Shared CI runners can be much slower under full-suite load.
	it.sequential(
		"handles deeply nested recursion without stack overflow",
		() => {
			// This test verifies the stack-based approach prevents stack overflow
			// Using match instead of if-then-else
			const src = `{
			let count = \\n -> \\acc -> match n 
				| 0 -> acc 
				| _ -> count (n - 1) (acc + 1);
			return (count 10000) 0;
		}`;
			const { structure } = elaborateFrom(src);
			const ctx = ctxFor(mkCtx());

			const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
			expect(nf.type).toBe("Lit");

			expect(show(nf, ctx)).toBe("10000");
		},
		20_000,
	);

	it("handles simple recursion", () => {
		// Simpler test: countdown
		const src = `{
			let countdown = \\n -> match n 
				| 0 -> 0
				| _ -> countdown (n - 1);
			return countdown 10;
		}`;
		const { structure } = elaborateFrom(src);
		const ctx = ctxFor(mkCtx());

		const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
		expect(nf.type).toBe("Lit");
		expect(show(nf, ctx)).toBe("0");
	});

	describe("delimited continuations (shift/reset)", () => {
		it("simple shift/reset", () => {
			const src = `{
				let test = reset (shift (resume 10));
				return test;
			}`;

			const { structure } = elaborateFrom(src);
			const ctx = ctxFor(mkCtx());

			const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
			expect(nf.type).toBe("Lit");
			expect(show(nf, ctx)).toBe("10");
		});

		it("resumption with computation", () => {
			const src = `{
				let test = reset (1 + (shift ((resume 10) + (resume 20))));
				return test;
			}`;

			const { structure } = elaborateFrom(src);
			const ctx = ctxFor(mkCtx());

			const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
			expect(nf.type).toBe("Lit");
			expect(show(nf, ctx)).toBe("32");
		});

		it("shifts under a lambda (Bubble produces neutral without delimiter)", () => {
			const src = `{
				let test = reset (\\x -> 1 + (shift (resume (x + 10))));
				return (test 5);
			}`;

			const { structure, displays } = elaborateFrom(src);
			const ctx = ctxFor(mkCtx());
			const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
			expect({ pretty: displays, nfType: nf.type }).toMatchSnapshot();
		});

		it("models looping continuation", () => {
			/* Example adapted from
			let while_ cond body =
			reset (fun () ->
				let rec loop () =
				if cond () then (
					shift (fun k ->
					body ();
					k ();       (* continue loop *)
					)
				) else
					()
				in
				loop ()
			)
			*/
			const src = `{
				let while
					: (Unit -> Bool) -> (Unit -> Unit) -> Unit
					= \\cond body -> reset ({
						let go = \\u -> shift (match (cond !)
							| true -> { body !; resume go !; }
							| false -> !);
						return go !;
					});
				return while;
			}`;

			const { structure, displays } = elaborateFrom(src);
			const ctx = ctxFor(mkCtx());

			const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
			//expect(nf.type).toBe("Lit");
			expect({
				displays,
				evaluation: show(nf, ctx, structure.metas),
			}).toMatchSnapshot();
		});
	});
});

describe("Normalization v2: glued references", () => {
	const Free = (name: string) => EB.Constructors.Var({ type: "Free", name });
	const unit = EB.Constructors.Lit(Lit.Atom("Unit"));
	const option = EB.Constructors.Lambda(
		"a",
		"Explicit",
		EB.Constructors.Variant(
			EB.Constructors.Extension("some", EB.Constructors.Var({ type: "Bound", index: 0 }), EB.Constructors.Extension("none", unit, R.Constructors.Empty())),
		),
		EB.Constructors.Lit(Lit.Type()),
	);

	const ctx = (() => {
		const base = mkCtx();
		const kind = NF.Constructors.Pi("a", "Explicit", NF.Type, NF.Constructors.Closure(base, EB.Constructors.Lit(Lit.Type())));
		const imports: EB.Context["imports"] = {
			...base.imports,
			Option: [option, kind, []],
			flag: [EB.Constructors.Lit(Lit.Bool(true)), NF.Constructors.Lit(Lit.Atom("Bool")), []],
			one: [EB.Constructors.Lit(Lit.Num(1)), NF.Constructors.Lit(Lit.Atom("Num")), []],
			point: [EB.Constructors.Struct(EB.Constructors.Extension("x", EB.Constructors.Lit(Lit.Num(1)), R.Constructors.Empty())), NF.Type, []],
		};
		return { ...base, imports };
	})();

	const optionNum = EB.Constructors.App("Explicit", Free("Option"), Free("Num"));

	it("evaluates a top-level reference to glue over its definition", () => {
		expect(runNF(ctx, () => NF.normalize(Free("Option")))).toMatchObject({
			type: "Glued",
			folded: { type: "Var", variable: { type: "Free", name: "Option" } },
			unfolded: NF.Patterns.Lambda,
		});
	});

	it("does not glue a primitive, which is defined as the atom of its own name", () => {
		expect(runNF(ctx, () => NF.normalize(Free("Num")))).toMatchObject({ type: "Lit", value: Lit.Atom("Num") });
	});

	it("lifts application over both faces, with the glue itself at the head of the folded face", () => {
		const nf = runNF(ctx, () => NF.normalize(optionNum));

		expect(nf).toMatchObject({
			type: "Glued",
			folded: {
				type: "App",
				func: { type: "Glued", folded: { type: "Var", variable: { name: "Option" } }, unfolded: NF.Patterns.Lambda },
				arg: { type: "Lit", value: Lit.Atom("Num") },
			},
		});
		expect(runNF(ctx, () => NF.view(nf))).toMatchObject({ kind: "Sealed", value: NF.Patterns.Variant });
	});

	it("reads back the reference, or with unfolded definitions what it computes", () => {
		const nf = runNF(ctx, () => NF.normalize(optionNum));
		const readback = (unfold: NF.Unfolding) =>
			shown(
				ctx,
				{},
			)(function* () {
				return yield* EB.Display.Term(yield* NF.quote(ctx.env.length, nf, { unfold }), { deBruijn: false });
			});

		expect(readback("none")).toBe("Option Num");
		expect(readback("definitions")).toContain("some: Num");
		expect(show(nf, ctx)).toBe("Option Num");
	});

	it("eliminates through glue", () => {
		const projected = runNF(ctx, () => NF.normalize(EB.Constructors.Proj("x", Free("point"))));
		const matched = runNF(ctx, () =>
			NF.normalize(
				EB.Constructors.Match(Free("flag"), [
					EB.Constructors.Alternative(EB.Constructors.Patterns.Lit(Lit.Bool(false)), EB.Constructors.Lit(Lit.Num(1)), []),
					EB.Constructors.Alternative(EB.Constructors.Patterns.Lit(Lit.Bool(true)), EB.Constructors.Lit(Lit.Num(2)), []),
				]),
			),
		);

		expect(projected).toMatchObject({ type: "Lit", value: Lit.Num(1) });
		expect(matched).toMatchObject({ type: "Lit", value: Lit.Num(2) });
	});

	it("computes primitives on the unfolded face", () => {
		const add = EB.Constructors.Var({ type: "Foreign", name: "$add" });
		const sum = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", add, Free("one")), EB.Constructors.Lit(Lit.Num(1)));

		expect(runNF(ctx, () => NF.normalize(sum))).toMatchObject({ type: "Lit", value: Lit.Num(2) });
	});
});
