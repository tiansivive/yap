import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

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
		const src = "{ x: 1, y: :x + 1 }.y";
		const { structure } = elaborateFrom(src);
		const ctx = ctxFor(mkCtx());

		const nf = runNF(ctx, () => NF.normalize(structure.term), structure.metas);
		expect(nf.type).toBe("Lit");
		expect(show(nf, ctx)).toBe("2");
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
