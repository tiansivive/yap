import { describe, it, expect } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as U from "@yap/elaboration/unification";
import * as Sub from "@yap/elaboration/unification/substitution";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
import * as Lib from "@yap/shared/lib/primitives";

const runUnify = (left: NF.Value, right: NF.Value) => {
	const ctx = Lib.defaultContext();
	const result = EB.V2.Do(function* () {
		const sub = yield* U.unify.gen(left, right, ctx.env.length, Sub.empty);
		return sub;
	})(ctx);
	return result;
};

const expectRight = <A>(out: ReturnType<typeof runUnify>): A => {
	if (out.result._tag === "Left") {
		throw new Error(EB.V2.display(out.result.left));
	}
	return out.result.right as unknown as A;
};

const expectLeft = (out: ReturnType<typeof runUnify>) => {
	if (out.result._tag === "Right") {
		throw new Error("Expected unification to fail");
	}
	return out.result.left;
};

describe("Unification (V2)", () => {
	it("unifies equal literals", () => {
		const l = NF.Constructors.Lit(Lit.Num(42));
		const r = NF.Constructors.Lit(Lit.Num(42));
		const out = runUnify(l, r);
		const sub = expectRight<Sub.Subst>(out);
		expect(Sub.display(sub, out.metas)).toBe("empty");
	});

	it("fails on different literals", () => {
		const l = NF.Constructors.Lit(Lit.Num(1));
		const r = NF.Constructors.Lit(Lit.Num(2));
		const out = runUnify(l, r);
		const err = expectLeft(out);
		expect(err.type).toBe("UnificationFailure");
		expect({ message: EB.V2.display(err) }).toMatchSnapshot();
	});

	it("unifies lambdas (same icit and body)", () => {
		const ctx = Lib.defaultContext();
		const body = EB.Constructors.Var({ type: "Bound", index: 0 });
		const lam1 = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure(ctx, body), NF.Any);
		const lam2 = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure(ctx, body), NF.Any);
		const out = runUnify(lam1, lam2);
		const sub = expectRight<Sub.Subst>(out);
		expect(Sub.display(sub, out.metas)).toBe("empty");
	});

	it("fails on lambda icit mismatch", () => {
		const ctx = Lib.defaultContext();
		const body = EB.Constructors.Var({ type: "Bound", index: 0 });
		const lam1 = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure(ctx, body), NF.Any);
		const lam2 = NF.Constructors.Lambda("x", "Implicit", NF.Constructors.Closure(ctx, body), NF.Any);
		const out = runUnify(lam1, lam2);
		const err = expectLeft(out);
		expect(err.type).toBe("TypeMismatch");
		expect({ message: EB.V2.display(err) }).toMatchSnapshot();
	});

	it("unifies Pis (annotation and body)", () => {
		const ctx = Lib.defaultContext();
		const ann = NF.Type;
		const body = EB.Constructors.Var({ type: "Bound", index: 0 });
		const pi1 = NF.Constructors.Pi("x", "Explicit", ann, NF.Constructors.Closure(ctx, body));
		const pi2 = NF.Constructors.Pi("x", "Explicit", ann, NF.Constructors.Closure(ctx, body));
		const out = runUnify(pi1, pi2);
		const sub = expectRight<Sub.Subst>(out);
		expect(Sub.display(sub, out.metas)).toBe("empty");
	});

	it("rigid variable mismatch", () => {
		const l = NF.Constructors.Rigid(0);
		const r = NF.Constructors.Rigid(1);
		const out = runUnify(l, r);
		const err = expectLeft(out);
		expect(err.type).toBe("RigidVariableMismatch");
		expect({ message: EB.V2.display(err) }).toMatchSnapshot();
	});

	it("unifies meta with value (bind)", () => {
		const meta = NF.Constructors.Flex({ type: "Meta", val: 1, lvl: 0 });
		const val = NF.Constructors.Lit(Lit.Num(7));
		const out = runUnify(meta, val);
		const sub = expectRight<Sub.Subst>(out);
		expect(Sub.display(sub, out.metas)).toContain("?1 |=> 7");
	});

	it("ignores modalities during unification", () => {
		const base = NF.Constructors.Lit(Lit.Num(9));
		const modal = NF.Constructors.Modal(base, { quantity: { tag: "Many" } as any, liquid: NF.Constructors.Lit(Lit.Bool(true)) });
		const out = runUnify(modal, base);
		const sub = expectRight<Sub.Subst>(out);
		expect(Sub.display(sub, out.metas)).toBe("empty");
	});

	describe("Row Unification", () => {
		it("unifies identical rows", () => {
			const l = NF.Constructors.Row(R.Constructors.Extension("x", NF.Constructors.Lit(Lit.Num(1)), R.Constructors.Empty()));
			const r = NF.Constructors.Row(R.Constructors.Extension("x", NF.Constructors.Lit(Lit.Num(1)), R.Constructors.Empty()));
			const out = runUnify(l, r);
			const sub = expectRight<Sub.Subst>(out);
			expect(Sub.display(sub, out.metas)).toBe("empty");
		});

		it("fails on missing label", () => {
			const l = NF.Constructors.Row(R.Constructors.Extension("x", NF.Constructors.Lit(Lit.Num(1)), R.Constructors.Empty()));
			const r = NF.Constructors.Row(R.Constructors.Empty());
			const out = runUnify(l, r);
			const err = expectLeft(out);
			expect(err.type === "MissingLabel" || err.type === "RowMismatch").toBeTruthy();
			expect({ message: EB.V2.display(err) }).toMatchSnapshot();
		});

		it("unifies polymorphic row with concrete row", () => {
			const l = NF.Constructors.Row(R.Constructors.Variable({ type: "Meta", val: 10, lvl: 0 }));
			const r = NF.Constructors.Row(R.Constructors.Extension("x", NF.Constructors.Lit(Lit.Num(2)), R.Constructors.Empty()));
			const out = runUnify(l, r);
			const sub = expectRight<Sub.Subst>(out);
			expect(Sub.display(sub, out.metas)).toContain("?10 |=> [ x: 2 ]");
		});

		it("merges two polymorphic rows", () => {
			const l = NF.Constructors.Row(
				R.Constructors.Extension("x", NF.Constructors.Lit(Lit.Num(42)), R.Constructors.Variable({ type: "Meta", val: 100, lvl: 0 })),
			);
			const r = NF.Constructors.Row(
				R.Constructors.Extension("y", NF.Constructors.Lit(Lit.Num(43)), R.Constructors.Variable({ type: "Meta", val: 101, lvl: 0 })),
			);
			const out = runUnify(l, r);
			const sub = expectRight<Sub.Subst>(out);
			const printed = Sub.display(sub, out.metas);
			expect(printed).toContain("?100 |=> [ y: 43 | ?");
			expect(printed).toContain("?101 |=> [ x: 42 | ?");
		});
	});

	describe("Mu Types", () => {
		const mkIdMuAbs = () => {
			const ctx = Lib.defaultContext();
			// body is just the bound variable; unfolding (apply) returns the argument unchanged
			const body = EB.Constructors.Var({ type: "Bound", index: 0 });
			return NF.Constructors.Mu("T", "test", NF.Type, NF.Constructors.Closure(ctx, body));
		};

		it("unifies Mu with Mu (same body under rigid)", () => {
			const mu1 = mkIdMuAbs();
			const mu2 = mkIdMuAbs();
			const out = runUnify(mu1, mu2);
			const sub = expectRight<Sub.Subst>(out);
			expect(Sub.display(sub, out.metas)).toBe("empty");
		});

		it("unfolds Mu in application context during unification (positive)", () => {
			const mu = mkIdMuAbs();
			const arg = NF.Constructors.Lit(Lit.Num(5));
			const app = NF.Constructors.App(mu, arg, "Explicit");
			const out = runUnify(app, arg);
			const sub = expectRight<Sub.Subst>(out);
			expect(Sub.display(sub, out.metas)).toBe("empty");
		});

		it("unfolds Mu in application context during unification (negative)", () => {
			const mu = mkIdMuAbs();
			const argL = NF.Constructors.Lit(Lit.Num(5));
			const argR = NF.Constructors.Lit(Lit.Num(6));
			const app = NF.Constructors.App(mu, argL, "Explicit");
			const out = runUnify(app, argR);
			const err = expectLeft(out);
			expect(err.type).toBe("UnificationFailure");
			expect({ message: EB.V2.display(err) }).toMatchSnapshot();
		});
	});

	describe("Foreign variables", () => {
		it("unifies same foreign symbol", () => {
			const l = NF.Constructors.Var({ type: "Foreign", name: "Indexed" });
			const r = NF.Constructors.Var({ type: "Foreign", name: "Indexed" });
			const out = runUnify(l, r);
			const sub = expectRight<Sub.Subst>(out);
			expect(Sub.display(sub, out.metas)).toBe("empty");
		});

		it("fails for different foreign symbols", () => {
			const l = NF.Constructors.Var({ type: "Foreign", name: "Indexed" });
			const r = NF.Constructors.Var({ type: "Foreign", name: "Other" });
			const out = runUnify(l, r);
			const err = expectLeft(out);
			expect(err.type).toBe("TypeMismatch");
			expect({ message: EB.V2.display(err) }).toMatchSnapshot();
		});
	});
});
