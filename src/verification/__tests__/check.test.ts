import { describe, it, expect, beforeAll, vi, afterAll, afterEach } from "vitest";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Lib from "@yap/shared/lib/primitives";

import { VerificationServiceV2 as VerificationService } from "@yap/verification/V2/service";
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
	it("verifies a literal against a simple refinement", async () => {
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

	it("verifies Nat type alias definition", async () => {
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

	it("verifies Pos type alias definition", async () => {
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

	it("verifies positive integer literal with refinement", async () => {
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

	it("verifies function definition fn", async () => {
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

	it("verifies higher-order function hof", async () => {
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

	it("verifies higher-order function hof2", async () => {
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

	it("verifies higher-order function hof3", async () => {
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

	it("verifies positive test - literal equals 1", async () => {
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

	it("verifies negative test - literal does not equal 1", async () => {
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

	it("verifies positive function application 1 + 2 as Nat", async () => {
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

	it("verifies negative function application - result does not equal 0", async () => {
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

	it("verifies lambda with postcondition returning constant 1", async () => {
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

	it("verifies negative lambda postcondition - identity does not guarantee Nat", async () => {
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

	it("verifies lambda with Nat precondition - identity preserves property", async () => {
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

	it("verifies lambda with Nat pre and postcondition - identity works", async () => {
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

	it("verifies negative lambda pre and postcondition - constant 0 fails", async () => {
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

	it("verifies lambda with dependent refinement on result", async () => {
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

	it("verifies inc function definition", async () => {
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

	it("verifies block expression with refined result", async () => {
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

	it("verifies dependent record construction", async () => {
		const src = `let test = {
			let Pair
				: (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
				= \\a -> \\b -> \\p -> { fst: a, snd: b[| \\v -> p :fst v |] };
		
			let p
				: Pair Num Num (\\x -> \\y -> x < y )
				= { fst: 1, snd: 2 };

			
		}`;

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

		const src2 = `let testFail = {
			let Pair
				: (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
				= \\a -> \\b -> \\p -> { fst: a, snd: b[| \\v -> p :fst v |] };
		
			let p
				: Pair Num Num (\\x -> \\y -> x < y )
				= { fst: 2, snd: 1 };

			return 1;
		}`;

		const [tm2, ty2, ctx2] = elaborate(src2);

		const { result: result2 } = V2.Do(() => V2.local(_ => ctx2, Verification.check(tm2, ty2)))(ctx2);
		if (result2._tag === "Left") {
			throw new Error(EB.V2.display(result2.left));
		}

		const artefacts2 = result2.right;
		const solver2 = new Z3.Solver();
		solver2.add(artefacts2.vc.eq(true));
		const sat2 = await solver2.check();
		expect(sat2).toBe("unsat");
		expect(artefacts2.vc.sexpr()).toMatchSnapshot();
	});

	it("verifies ordered list construction", async () => {
		const src = `let orderedListTest = {
			let List
				: (a: Type) -> (p: a -> a -> Bool) -> Type
				= \\t -> \\p -> | #nil Unit
								| #cons { head: t, tail: List (t[| \\v -> p :head v |]) p };

			let ol
				: List Num (\\x -> \\y -> x < y )
				= #cons { head: 1, tail: #cons { head: 2, tail: #nil ! } };

			return 1;	
		}`;

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

		const src2 = `let orderedListTestFail = {
			let List
				: (a: Type) -> (p: a -> a -> Bool) -> Type
				= \\t -> \\p -> | #nil Unit
								| #cons { head: t, tail: List (t[| \\v -> p :head v |]) p };

			let ol
				: List Num (\\x -> \\y -> x < y )
				= #cons { head: 2, tail: #cons { head: 1, tail: #nil ! } };

			return 1;	
		}`;

		const [tm2, ty2, ctx2] = elaborate(src2);

		const { result: result2 } = V2.Do(() => V2.local(_ => ctx2, Verification.check(tm2, ty2)))(ctx2);
		if (result2._tag === "Left") {
			throw new Error(EB.V2.display(result2.left));
		}

		const artefacts2 = result2.right;
		const solver2 = new Z3.Solver();
		solver2.add(artefacts2.vc.eq(true));
		const sat2 = await solver2.check();
		expect(sat2).toBe("unsat");
		expect(artefacts2.vc.sexpr()).toMatchSnapshot();
	});

	describe("Flow-sensitive type refinement", () => {
		it("refines type in if-then-else branches", async () => {
			const src = `let test = {
				let a = 1;
				let b: Num[| \\n -> n > 0 |] = match (a > 0)
					| true  -> a
					| false -> 42;

				return 1;
			}`;

			/*
				Seems like b is shifting the indices incorrectly.
				the VC ends up with (= x b) when it should be (= x a)
				There's probably a bug with the block verification
				We also need to run entailment on block letdecs to quantify over introduced variables.
			*/
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
});
