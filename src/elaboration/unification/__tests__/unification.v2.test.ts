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
	const [result] = EB.V2.Do(function* () {
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

		describe("Sigma types unification", () => {
			it("unifies identical Sigmas with empty row", () => {
				const ctx = Lib.defaultContext();
				const emptyRow = NF.Constructors.Row(R.Constructors.Empty());
				const schema = EB.Constructors.Schema(R.Constructors.Empty());
				const sig1 = NF.Constructors.Sigma("r", emptyRow, NF.Constructors.Closure(ctx, schema));
				const sig2 = NF.Constructors.Sigma("r", emptyRow, NF.Constructors.Closure(ctx, schema));
				const out = runUnify(sig1, sig2);
				const sub = expectRight<Sub.Subst>(out);
				expect(Sub.display(sub, out.metas)).toBe("empty");
			});

			it("unifies Sigmas with single-field row", () => {
				const ctx = Lib.defaultContext();
				const row = NF.Constructors.Row(R.Constructors.Extension("x", NF.Type, R.Constructors.Empty()));
				const schema = EB.Constructors.Schema(R.Constructors.Extension("x", EB.Constructors.Lit(Lit.Atom("Num")), R.Constructors.Empty()));
				const sig1 = NF.Constructors.Sigma("r", row, NF.Constructors.Closure(ctx, schema));
				const sig2 = NF.Constructors.Sigma("r", row, NF.Constructors.Closure(ctx, schema));
				const out = runUnify(sig1, sig2);
				const sub = expectRight<Sub.Subst>(out);
				expect(Sub.display(sub, out.metas)).toBe("empty");
			});

			it("fails on Sigma row annotation mismatch", () => {
				const ctx = Lib.defaultContext();
				const row1 = NF.Constructors.Row(R.Constructors.Extension("x", NF.Type, R.Constructors.Empty()));
				const row2 = NF.Constructors.Row(R.Constructors.Extension("y", NF.Type, R.Constructors.Empty()));
				const schema = EB.Constructors.Schema(R.Constructors.Empty());
				const sig1 = NF.Constructors.Sigma("r", row1, NF.Constructors.Closure(ctx, schema));
				const sig2 = NF.Constructors.Sigma("r", row2, NF.Constructors.Closure(ctx, schema));
				const out = runUnify(sig1, sig2);
				const err = expectLeft(out);
				expect(err.type === "MissingLabel" || err.type === "RowMismatch" || err.type === "TypeMismatch").toBeTruthy();
				expect({ message: EB.V2.display(err) }).toMatchSnapshot();
			});

			it("unifies Sigmas with polymorphic row variables", () => {
				const ctx = Lib.defaultContext();
				const rowVar = NF.Constructors.Row(R.Constructors.Variable({ type: "Meta", val: 1, lvl: 0 }));
				const concreteRow = NF.Constructors.Row(R.Constructors.Extension("field", NF.Type, R.Constructors.Empty()));
				const schema = EB.Constructors.Schema(R.Constructors.Variable({ type: "Meta", val: 2, lvl: 0 }));
				const sig1 = NF.Constructors.Sigma("r", rowVar, NF.Constructors.Closure(ctx, schema));
				const sig2 = NF.Constructors.Sigma("r", concreteRow, NF.Constructors.Closure(ctx, schema));
				const out = runUnify(sig1, sig2);
				const sub = expectRight<Sub.Subst>(out);
				expect(Sub.display(sub, out.metas)).toContain("?1 |=> [ field: Type ]");
			});

			it("unifies Sigma with polymorphic row bodies", () => {
				const ctx = Lib.defaultContext();
				const row = NF.Constructors.Row(R.Constructors.Extension("x", NF.Type, R.Constructors.Empty()));

				const schemaRow1: EB.Row = R.Constructors.Variable({ type: "Meta", val: 3, lvl: 0 });
				const schemaRow2: EB.Row = R.Constructors.Variable({ type: "Meta", val: 4, lvl: 0 });
				const schema1 = EB.Constructors.Schema(schemaRow1);
				const schema2 = EB.Constructors.Schema(schemaRow2);
				const sig1 = NF.Constructors.Sigma("r", row, NF.Constructors.Closure(ctx, schema1));
				const sig2 = NF.Constructors.Sigma("r", row, NF.Constructors.Closure(ctx, schema2));
				const out = runUnify(sig1, sig2);
				const sub = expectRight<Sub.Subst>(out);

				const printed = Sub.display(sub, out.metas);
				expect(printed).toContain("?3");
				expect(printed).toContain("?4");
			});
		});
	});

	describe("Mu Types", () => {
		// Use a contractive body to avoid infinite unfolding: µ T. 0
		// This ignores its parameter and always unfolds to the constant 0.
		const mkConstMuAbs = () => {
			const ctx = Lib.defaultContext();
			const ann = EB.Constructors.Lit(Lit.Atom("Num"));
			const body = EB.Constructors.Lambda("x", "Explicit", EB.Constructors.Lit(Lit.Num(0)), ann);
			return NF.Constructors.Mu("T", "test", NF.Type, NF.Constructors.Closure(ctx, body));
		};

		it("unifies Mu with Mu when body references binder (non-function body)", () => {
			// µT. T  vs  µT. T  should unify by substituting Rigid(lvl) for T in the body
			const ctx = Lib.defaultContext();
			const body = EB.Constructors.Var({ type: "Bound", index: 0 });
			const mu1 = NF.Constructors.Mu("T", "id", NF.Type, NF.Constructors.Closure(ctx, body));
			const mu2 = NF.Constructors.Mu("T", "id", NF.Type, NF.Constructors.Closure(ctx, body));
			const out = runUnify(mu1, mu2);
			const sub = expectRight<Sub.Subst>(out);
			expect(Sub.display(sub, out.metas)).toBe("empty");
		});

		it("unfolds Mu in application context during unification (positive)", () => {
			const mu = mkConstMuAbs();
			const arg = NF.Constructors.Lit(Lit.Num(1));
			const app = NF.Constructors.App(mu, arg, "Explicit");
			// Since the body is constant 0, App(mu, arg) should unify with 0
			const out = runUnify(app, NF.Constructors.Lit(Lit.Num(0)));
			const sub = expectRight<Sub.Subst>(out);
			expect(Sub.display(sub, out.metas)).toBe("empty");
		});

		it("unfolds Mu in application context during unification (negative)", () => {
			const mu = mkConstMuAbs();
			const argL = NF.Constructors.Lit(Lit.Num(5));
			const app = NF.Constructors.App(mu, argL, "Explicit");
			// App(mu, arg) unfolds to 0, so unifying with 1 must fail
			const out = runUnify(app, NF.Constructors.Lit(Lit.Num(1)));
			const err = expectLeft(out);
			expect(err.type).toBe("UnificationFailure");
			expect({ message: EB.V2.display(err) }).toMatchSnapshot();
		});

		it("unfolds Mu without application when comparing against value (non-function body)", () => {
			// Body is NOT a function; unification should unfold Mu on either side
			const ctx = Lib.defaultContext();
			const body = EB.Constructors.Lit(Lit.Num(1));
			const mu = NF.Constructors.Mu("T", "one", NF.Type, NF.Constructors.Closure(ctx, body));
			const out = runUnify(mu, NF.Constructors.Lit(Lit.Num(1)));
			const sub = expectRight<Sub.Subst>(out);
			expect(Sub.display(sub, out.metas)).toBe("empty");
		});

		it("fails when unfolding Mu without application hits mismatch (non-function body)", () => {
			const ctx = Lib.defaultContext();
			const body = EB.Constructors.Lit(Lit.Num(1));
			const mu = NF.Constructors.Mu("T", "one", NF.Type, NF.Constructors.Closure(ctx, body));
			const out = runUnify(mu, NF.Constructors.Lit(Lit.Num(0)));
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
