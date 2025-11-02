import { describe, it, expect, beforeAll } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Lib from "@yap/shared/lib/primitives";

import { VerificationService } from "@yap/verification/service";
import { init, type Context } from "z3-solver";

let Z3: Context<"main">;

beforeAll(async () => {
	// Initialize Z3 asynchronously and create a context named "main"
	const z3 = await init();
	Z3 = z3.Context("main");
});

describe("VerificationService.check", () => {
	it("checks a literal against a simple refinement", async () => {
		const ctx = Lib.defaultContext();

		// Term: the number 5
		const term = EB.Constructors.Lit(Lit.Num(5));

		// Type: { x: Num | x > 0 }
		const num = NF.Constructors.Lit(Lit.Atom("Num"));
		const x = EB.Constructors.Var(EB.Bound(0));
		const gtZero = EB.DSL.gt(x, EB.Constructors.Lit(Lit.Num(0)));
		const pred = NF.Constructors.Lambda("x", "Explicit", NF.Constructors.Closure(ctx, gtZero), num);
		const ty = NF.Constructors.Modal(num, { quantity: Q.Many, liquid: pred });

		const Verification = VerificationService(Z3);

		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(term, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;

		// Validate the resulting VC with Z3
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
	});
});
