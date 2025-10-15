import { init, Sort } from "z3-solver";

console.log("Starting Z3...");
const run = async () => {
	const { Context, setParam } = await init();

	const Z3 = Context("main");

	const A = Z3.Sort.declare("A");
	const a = Z3.Const("a", A);

	const x = Z3.Int.const("x");
	const implication = Z3.Implies(x.gt(1), x.gt(0));
	const lambda = Z3.Lambda([x], Z3.Or(Z3.Not(x.gt(5)), x.lt(10)));

	const formula = Z3.And(Z3.ForAll([x], implication), Z3.Bool.val(false));

	const solver = new Z3.Solver();

	console.log("Solving...");
	solver.add(formula.eq(true));
	const result = await solver.check();
	console.log("Result:", result);
};

run();
