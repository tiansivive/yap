import { describe, it, expect, beforeAll, vi, afterAll, afterEach } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Lib from "@yap/shared/lib/primitives";

import { VerificationService } from "@yap/verification/service";
import { init, type Context } from "z3-solver";
import { elaborate } from "./helpers";
import { beforeEach } from "node:test";

describe("VerificationService", () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;
	let Z3: Context<"main">;
	beforeAll(async () => {
		// Initialize Z3 asynchronously and create a context named "main"
		const z3 = await init();
		Z3 = z3.Context("main");

		//vi.spyOn(console, 'error').mockImplementation(() => { })
	});

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.resetAllMocks();
	});
	it("checks a literal against a simple refinement", async () => {
		const src = `let x: Num [| \\n -> n == 42|] = 42`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks Nat type alias definition", async () => {
		const src = `let Nat: Type = Num [| \\n -> n > 0 |]`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks Pos type alias definition", async () => {
		const src = `let Pos: Type = Num [| \\p -> p > 1 |]`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks positive integer literal with refinement", async () => {
		const src = `let n: Num [| \\n -> n > 0 |] = 100`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks function definition fn", async () => {
		const src = `let fn: Num -> Num = \\x -> 2`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks higher-order function hof", async () => {
		const src = `let hof: (f: Num [| \\n -> n > 0|] -> Num [| \\n -> n > 0|]) -> Num [| \\n -> n > 0|] = \\f -> f 1`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks higher-order function hof2", async () => {
		const src = `let hof2: (Num -> Num [| \\n -> n > 0 |]) -> Num [| \\p -> p > 1 |] = \\f -> (f 1) + 1`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks higher-order function hof3", async () => {
		const src = `let hof3: Num -> (Num -> Num) -> Num = \\x -> \\f -> (f x) + 1`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks positive test - literal equals 1", async () => {
		const src = `let posTestCheckLiteral: Num [| \\v -> v == 1 |] = 1`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks negative test - literal does not equal 1", async () => {
		const src = `let negTestCheckLiteral: Num [| \\v -> v == 1 |] = 2`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("unsat");
	});

	it("checks positive function application 1 + 2 as Nat", async () => {
		const src = `let posFnApp: Num [| \\n -> n > 0|] = 1 + 2`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks negative function application - result does not equal 0", async () => {
		const src = `let negFnApp: Num [| \\v -> v == 0 |] = 1 + 2`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("unsat");
	});

	it("checks lambda with postcondition returning constant 1", async () => {
		const src = `let posTestCheckLambdaPostCondition: Num -> Num [| \\v -> v == 1 |] = \\x -> 1`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks negative lambda postcondition - identity does not guarantee Nat", async () => {
		const src = `let negTestCheckLambdaPostCondition: Num -> Num [| \\n -> n > 0|] = \\x -> x`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("unsat");
	});

	it("checks lambda with Nat precondition - identity preserves property", async () => {
		const src = `let posTestCheckLambdaPreCondition: (n: Num [| \\n -> n > 0|]) -> Num = \\x -> x`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks lambda with Nat pre and postcondition - identity works", async () => {
		const src = `let posTestCheckLambdaPreAndPostCondition: (n: Num [| \\n -> n > 0|]) -> Num [| \\n -> n > 0|] = \\x -> x`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks negative lambda pre and postcondition - constant 0 fails", async () => {
		const src = `let negTestCheckLambdaPreAndPostCondition: (n: Num [| \\n -> n > 0|]) -> Num [| \\n -> n > 0|] = \\x -> 0`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("unsat");
	});

	it("checks lambda with dependent refinement on result", async () => {
		const src = `let posTestCheckRefinedResultLambda: (n: Num) -> Num [| \\o -> o == (n + 1) |] = \\x -> x + 1`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks inc function definition", async () => {
		const src = `let inc: (x: Num) -> Num [| \\v -> v == (x + 1) |] = \\x -> x + 1`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});

	it("checks block expression with refined result", async () => {
		const src = `let block: Num [| \\n -> n > 0|] = { let f: Num [| \\n -> n > 0|] -> Num [| \\p -> p > 1|] = \\o -> o + 1; return (f 1); }`;
		const [tm, ty, ctx] = elaborate(src);

		const Verification = VerificationService(Z3);
		const { result } = V2.Do(() => V2.local(_ => ctx, Verification.check(tm, ty)))(ctx);
		if (result._tag === "Left") {
			throw new Error(EB.V2.display(result.left));
		}

		const artefacts = result.right;
		const solver = new Z3.Solver();
		solver.add(artefacts.vc.eq(true));
		const sat = await solver.check();
		expect(sat).toBe("sat");
		expect(artefacts.vc.sexpr()).toMatchSnapshot();
	});
});
