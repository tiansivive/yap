import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Eval from "../evaluation.v2";

import { elaborateFrom, mkCtx } from "../../inference/__tests__/util";
import { update } from "@yap/utils";

const ctxFor = (base = mkCtx(), metas: EB.Context["metas"] = {}) => ({
	...base,
	metas: { ...base.metas, ...metas },
});

const show = (v: NF.Value, ctx: EB.Context) => NF.display(v, { env: ctx.env, zonker: ctx.zonker, metas: ctx.metas });

describe("Normalization v2 (stack-based): evaluation / reduce / matching", () => {
	it("evaluates literals and arithmetic to WHNF", () => {
		const { structure } = elaborateFrom("1 + 2");
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = Eval.evaluate(ctx, structure.term);

		// WHNF check: should be a literal after computing FFI op
		expect(nf.type).toBe("Lit");
		expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
	});

	it("evaluates lambda application via reduce to WHNF", () => {
		const { structure } = elaborateFrom("(\\x -> x) 1");
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = Eval.evaluate(ctx, structure.term);
		expect(nf.type).toBe("Lit");
		expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
	});

	it("evaluates rows + projection", () => {
		const { structure } = elaborateFrom("{ x: 1, y: 2 }.x");
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = Eval.evaluate(ctx, structure.term);
		expect(nf.type).toBe("Lit");
		expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
	});

	it("pattern matches on a struct", () => {
		const src = ["match { a: 1, b: 2}", "  | { a: x, b: y } -> x", "  | _ -> 0"].join("\n");
		const { structure } = elaborateFrom(src);
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = Eval.evaluate(ctx, structure.term);
		expect(nf.type).toBe("Lit");
		expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
	});

	it("evaluates dependent record projection", () => {
		const src = "{ x: 1, y: :x + 1 }.y";
		const { structure } = elaborateFrom(src);
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = Eval.evaluate(ctx, structure.term);
		expect(nf.type).toBe("Lit");
		expect({ structure, pretty: show(nf, ctx) }).toMatchSnapshot();
	});

	it("handles deeply nested recursion without stack overflow", () => {
		// This test verifies the stack-based approach prevents stack overflow
		// Using match instead of if-then-else
		const src = `{
			let count = \\n -> \\acc -> match n 
				| 0 -> acc 
				| _ -> count (n - 1) (acc + 1);
			return (count 10000) 0;
		}`;
		const { structure } = elaborateFrom(src);
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = Eval.evaluate(ctx, structure.term);
		expect(nf.type).toBe("Lit");

		expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
	});

	it("handles simple recursion", () => {
		// Simpler test: countdown
		const src = `{
			let countdown = \\n -> match n 
				| 0 -> 0
				| _ -> countdown (n - 1);
			return countdown 10;
		}`;
		const { structure } = elaborateFrom(src);
		const ctx = ctxFor(mkCtx(), structure.metas);

		const nf = Eval.evaluate(ctx, structure.term);
		expect(nf.type).toBe("Lit");
		expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
	});

	describe("delimited continuations (shift/reset)", () => {
		it("simple shift/reset", () => {
			const src = `{
				let test = reset (shift (resume 10));
				return test;
			}`;

			const { structure, state } = elaborateFrom(src);
			const ctx = ctxFor(mkCtx(), structure.metas);

			const nf = Eval.evaluate(ctx, structure.term, undefined, state.skolems);
			expect(nf.type).toBe("Lit");
			expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
		});

		it("resumption with computation", () => {
			const src = `{
				let test = reset (1 + (shift ((resume 10) + (resume 20))));
				return test;
			}`;

			const { structure, state } = elaborateFrom(src);
			const ctx = ctxFor(mkCtx(), structure.metas);

			const nf = Eval.evaluate(ctx, structure.term, undefined, state.skolems);
			expect(nf.type).toBe("Lit");
			expect({ pretty: show(nf, ctx) }).toMatchSnapshot();
		});

		it("shifts under a lambda", () => {
			const src = `{
				let test = reset (\\x -> 1 + (shift (resume (x + 10))));
				return (test 5);
			}`;

			const { structure, displays, state } = elaborateFrom(src);
			const ctx = ctxFor(mkCtx(), structure.metas);
			expect(() => Eval.evaluate(ctx, structure.term, undefined, state.skolems)).toThrow("Shift without enclosing reset");

			expect({ pretty: displays }).toMatchSnapshot();
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

			const { structure, state, displays, zonker } = elaborateFrom(src);
			const ctx = update(ctxFor(mkCtx(), structure.metas), "zonker", z => ({ ...z, ...zonker }));

			const nf = Eval.evaluate(ctx, structure.term, undefined, state.skolems);
			//expect(nf.type).toBe("Lit");
			expect({
				displays,
				evaluation: show(nf, ctx),
			}).toMatchSnapshot();
		});
	});
});
