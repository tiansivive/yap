import { init, Sort } from "z3-solver";

console.log("Starting Z3...");
const run = async () => {
	const { Context, setParam } = await init();

	const Z3 = Context("main");

	const x = Z3.Int.const("x");

	// Test model extraction
	const negSolver = new Z3.Solver();
	negSolver.add(x.gt(5).eq(false));
	const negResult = await negSolver.check();
	console.log("Negation result:", negResult);
	if (negResult === "sat") {
		const model = negSolver.model();
		console.log("\nModel type:", typeof model);
		console.log("Model proto:", Object.getPrototypeOf(model));
		console.log("Model own keys:", Object.getOwnPropertyNames(model));
		console.log("Model toString:", String(model));

		// Try common methods
		console.log("\nTrying common methods:");
		console.log("  sexpr():", model.sexpr?.());
		console.log("  length():", model.length?.());
		console.log("  entries():", model.entries?.());

		// Try getting declarations
		const decls = model.decls?.();
		if (decls && decls.length > 0) {
			console.log("\nModel has", decls.length, "declarations");
			for (let i = 0; i < decls.length; i++) {
				const decl = decls[i];
				console.log(`  [${i}] decl:`, decl, "value:", model.get?.(decl));
			}
		}

		// Try eval directly
		console.log("\nDirect eval of x:", model.eval(x));
	}
};

run();
