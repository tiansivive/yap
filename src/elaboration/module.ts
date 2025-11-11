import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as M from "@yap/elaboration/shared/monad";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as Q from "@yap/shared/modalities/multiplicity";

import { Either } from "fp-ts/lib/Either";

import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";

import { set, update } from "@yap/utils";

import { Interface } from "../modules/loading";
import { solve } from "./solver";
import * as A from "fp-ts/lib/Array";

import * as Sub from "@yap/elaboration/unification/substitution";
import { VerificationService } from "@yap/verification/service";
import { match } from "ts-pattern";
import { Bool, init, Model } from "z3-solver";
import { getZ3Context } from "@yap/shared/config/options";
import { PPretty } from "./pretty";

export const elaborate = (mod: Src.Module, ctx: EB.Context) => {
	const maybeExport = (name: string) => (result: Omit<Interface, "imports">) => {
		if (
			mod.exports.type === "*" ||
			(mod.exports.type === "explicit" && mod.exports.names.includes(name)) ||
			(mod.exports.type === "partial" && !mod.exports.hiding.includes(name))
		) {
			return update(result, "exports", A.append(name));
		}
		return result;
	};

	type Pair = [string, Either<EB.V2.Err, EB.AST>];
	const next = (stmts: Src.Statement[], ctx: EB.Context): Omit<Interface, "imports"> => {
		if (stmts.length === 0) {
			return { foreign: [], exports: [], letdecs: [], errors: [] };
		}

		const [head, ...tail] = stmts;

		if (head.type === "using") {
			return F.pipe(
				using(head, ctx),
				E.match(
					e => update(next(tail, ctx), "errors", A.prepend(e)),
					ctx => next(tail, ctx),
				),
			);
		}

		if (head.type === "foreign") {
			const [name, result] = foreign(head, ctx);
			return F.pipe(
				result,
				E.match(
					e => update(next(tail, ctx), "foreign", A.prepend<Pair>([name, E.left(e)])),
					([ast, ctx]) => F.pipe(next(tail, ctx), update("foreign", A.prepend<Pair>([name, E.right(ast)])), maybeExport(name)),
				),
			);
		}

		if (head.type === "let") {
			const [name, result] = letdec(head, ctx);

			return F.pipe(
				result,
				E.match(
					e => update(next(tail, ctx), "letdecs", A.prepend<Pair>([name, E.left(e)])),
					([ast, ctx]) => F.pipe(next(tail, ctx), update("letdecs", A.prepend<Pair>([name, E.right(ast)])), maybeExport(name)),
				),
			);
		}

		console.warn("Unrecognized statement", head);
		return next(tail, ctx);
	};

	const result = next(mod.content.script, ctx);
	console.log("\n================ Module Elaboration ================\n");
	console.log("Exports:");
	console.log(result.exports);
	console.log("Foreigns:");
	console.log(result.foreign);
	console.log("Let Declarations:");
	console.log(result.letdecs);
	console.log("Errors:");
	console.log(result.errors);
	console.log("\n===================================================\n");
	return result;
};

export const foreign = (stmt: Extract<Src.Statement, { type: "foreign" }>, ctx: EB.Context): [string, Either<V2.Err, [EB.AST, EB.Context]>] => {
	const check = EB.check(stmt.annotation, NF.Type);
	const { result } = check(ctx);
	const e = E.Functor.map(result, ([tm, us]): [EB.AST, EB.Context] => {
		const nf = NF.evaluate(ctx, tm);
		const v = EB.Constructors.Var({ type: "Foreign", name: stmt.variable });
		return [[v, nf, us], set(ctx, ["imports", stmt.variable] as const, [v, nf, us])];
	});

	return [stmt.variable, e];
};

export const using = (stmt: Extract<Src.Statement, { type: "using" }>, ctx: EB.Context): Either<V2.Err, EB.Context> => {
	const infer = EB.Stmt.infer(stmt);
	const { result } = infer(ctx);
	type Implicit = EB.Context["implicits"][0];
	return E.Functor.map(result, ([t, ty]) => update(ctx, "implicits", A.append<Implicit>([t.value, ty])));
};

export const letdec = (stmt: Extract<Src.Statement, { type: "let" }>, ctx: EB.Context): [string, Either<V2.Err, [EB.AST, EB.Context]>] => {
	const inference = V2.Do(function* () {
		const [elaborated, ty, us] = yield* EB.Stmt.infer.gen(stmt);
		console.log("\n------------------ LETDEC --------------------------------");
		const [r, next] = yield* EB.Stmt.letdec(elaborated as Extract<EB.Statement, { type: "Let" }>);
		//const [r, next] = yield* V2.liftE(result)
		console.log("Elaborated:\n", EB.Display.Statement(r, next));
		// const { constraints, metas } = yield* V2.listen();
		// const subst = yield* V2.local(
		// 	update("metas", ms => ({ ...ms, ...metas })),
		// 	solve(constraints),
		// );
		// //const tyZonked = yield* EB.zonk.gen("nf", ty, subst);
		// const zonked = F.pipe(
		// 	ctx,
		// 	update("metas", prev => ({ ...prev, ...metas })),
		// 	set("zonker", Sub.compose(subst, ctx.zonker)),
		// );

		// // Trim the recursive variable from closures in the type before generalizing.
		// // During inference, the recursive variable is added to env at level 0, and any closures
		// // created during inference capture this env. We need to trim it before generalization
		// // since we'll be moving the variable to imports instead of keeping it in env.
		// const trimmedTy = NF.trimClosureEnvs(ty);

		// const [generalized, next] = NF.generalize(trimmedTy, zonked);
		// const instantiated = NF.instantiate(generalized, next);

		// const xtended = EB.bind(next, { type: "Let", variable: stmt.variable }, instantiated);
		// const wrapped = F.pipe(
		// 	EB.Icit.instantiate(elaborated.value, xtended),
		// 	// inst => EB.Icit.generalize(inst, xtended),
		// 	tm => EB.Icit.wrapLambda(tm, instantiated, xtended),
		// );

		// const zCtx = getZ3Context();
		// if (!zCtx) {
		// 	throw new Error("Z3 context not set");
		// }

		// const Verification = VerificationService(zCtx);

		// const { result: res } = V2.Do(() => V2.local(_ => xtended, Verification.check(wrapped, instantiated)))(xtended);
		// if (res._tag === "Left") {
		// 	console.log("Verification failure");
		// 	console.log(res.left);
		// 	throw new Error("Verification failure");
		// }
		// const result = res.right;
		// const artefacts = result;

		// const solver = new zCtx.Solver();

		// solver.add(artefacts.vc.eq(true));
		// solver.check().then(res => {
		// 	// Eager local obligation checks
		// 	const obligations = Verification.getObligations?.() ?? [];
		// 	if (obligations.length) {
		// 		console.log("\nLocal obligations (closed subformulas):");
		// 	}
		// 	return Promise.all(
		// 		obligations.map(async ({ label, expr, context }) => {
		// 			const s = new zCtx.Solver();
		// 			s.add(expr.eq(true));
		// 			const r = await s.check();
		// 			let model: Model | undefined;
		// 			if (r === "unsat") {
		// 				// Try to extract a counterexample by solving the negation
		// 				const neg = new zCtx.Solver();
		// 				// Negate obligation by equating it to false to obtain a witness
		// 				neg.add(expr.eq(false));
		// 				const rn = await neg.check();
		// 				if (rn === "sat") {
		// 					model = neg.model();
		// 				}
		// 			}
		// 			return { label, result: r, expr, model, context };
		// 		}),
		// 	).then(async rs => {
		// 		console.log("\n------------------ LETDEC --------------------------------");
		// 		console.log("Elaborated:\n", EB.Display.Statement(elaborated, xtended));
		// 		console.log("Wrapped:\n", await PPretty.Term(wrapped, xtended));
		// 		console.log("Instantiated:\n", await NF.PPretty.Value(instantiated, xtended));

		// 		console.log("\n\n--------------------DEBUG VERIFICATION--------------------");
		// 		// console.log("RESULT:");
		// 		// console.log(result);

		// 		//console.log("\nSynthed:\n", NF.display(synthed, next));
		// 		console.log("\nArtefacts:");
		// 		console.log("Usages:\n", artefacts.usages);

		// 		console.log("\n--------------------FORMULA----------------------");
		// 		console.log("Z3 Sat:", res);
		// 		console.log("VC (Z3):\n", artefacts.vc.sexpr());
		// 		console.log("\n-------------------- SUBFORMULAS ----------------------");
		// 		rs.forEach(({ label, result, expr, model, context }, i) => {
		// 			console.log(` - [${result}] ${label}`);
		// 			if (context) {
		// 				if (context.description) {
		// 					if (Array.isArray(context.description)) {
		// 						console.log(`   description:`);
		// 						for (const line of context.description) {
		// 							console.log(`     ${line}`);
		// 						}
		// 					} else {
		// 						console.log(`   description: ${context.description}`);
		// 					}
		// 				}

		// 				if (context.term) {
		// 					console.log(`   term: ${context.term}`);
		// 				}

		// 				if (context.type) {
		// 					console.log(`   type: ${context.type}`);
		// 				}
		// 			}
		// 			if (result === "unsat") {
		// 				//console.log("   expr:", expr.sexpr());
		// 				if (model) {
		// 					// Try to extract variable values from the model
		// 					console.log("   counterexample:");
		// 					const decls = model.decls();
		// 					if (decls && decls.length > 0) {
		// 						for (const decl of decls) {
		// 							const name = decl.name();
		// 							const value = model.get(decl);
		// 							console.log(`     ${name} = ${value}`);
		// 						}
		// 					} else {
		// 						// Fallback: print the entire model
		// 						console.log("     ", model.sexpr());
		// 					}
		// 				}
		// 			}
		// 		});

		// 		console.log("------------------- END LETDEC --------------------------------\n");
		// 	});
		// });

		// console.log("\n------------------ LETDEC --------------------------------");
		// const statement = EB.Constructors.Stmt.Let(stmt.variable, wrapped, instantiated);
		// console.log("Elaborated:\n", EB.Display.Statement(statement, xtended));

		// PPretty.Term(elaborated.value, xtended).then(pretty => {
		// 	console.log("Pretty Elaborated:\n", pretty);
		// });

		// console.log("Wrapped:\n", EB.Display.Term(wrapped, xtended));
		// console.log("Instantiated:\n", NF.display(instantiated, xtended));

		const ast: EB.AST = [r.value, r.annotation, us];
		return [ast, set(next, ["imports", stmt.variable] as const, ast)] satisfies [EB.AST, EB.Context];
	});

	const { result } = inference(ctx);
	return [stmt.variable, result];
};

export const expression = (stmt: Extract<Src.Statement, { type: "expression" }>, ctx: EB.Context) => {
	const inference = V2.Do(function* () {
		const [elaborated, ty, us] = yield* EB.infer.gen(stmt.value);
		const { constraints, metas } = yield* V2.listen();
		const subst = yield* V2.local(
			update("metas", ms => ({ ...ms, ...metas })),
			solve(constraints),
		);

		console.log("Substitution:\n", Sub.display(subst, metas));
		const zonked = F.pipe(
			ctx,
			update("metas", prev => ({ ...prev, ...metas })),
			set("zonker", Sub.compose(subst, ctx.zonker)),
		);
		const [generalized, next] = NF.generalize(ty, zonked);
		const instantiated = NF.instantiate(generalized, next);

		const wrapped = F.pipe(
			EB.Icit.instantiate(elaborated, next),
			inst => EB.Icit.generalize(inst, next),
			tm => EB.Icit.wrapLambda(tm, ty, next),
		);

		// init().then(z3 => {
		// 	const zCtx = z3.Context("main");
		// 	z3.enableTrace("main");

		// 	const Verification = VerificationService(zCtx);
		// 	const { result: res } = V2.Do(() => V2.local(_ => next, Verification.synth(wrapped)))(next);
		// 	if (res._tag === "Left") {
		// 		console.log("Verification failure");
		// 		console.log(res.left);
		// 		return;
		// 	}
		// 	const result = res.right;
		// 	console.log("\n\n--------------------------DEBUG---------------------------------");
		// 	console.log("RESULT:");
		// 	console.log(result);
		// 	const [synthed, artefacts] = result;
		// 	console.log("\nSynthed:\n", NF.display(synthed, next));
		// 	console.log("\nArtefacts:");
		// 	console.log("Usages:\n", artefacts.usages);

		// 	// console.log("VC:\n", NF.display(artefacts.vc., next));
		// 	//console.log("Simplified:\n", NF.display(tmp_simplify(artefacts.vc), next));
		// 	console.log("VC (Z3):\n", artefacts.vc);
		// 	const solver = new zCtx.Solver();
		// 	solver.add(artefacts.vc as Bool);
		// 	const check = solver.check();
		// 	console.log("Z3 Sat:", check);

		// 	console.log("\n-----------------------END DEBUG------------------------------------\n");
		// });
		return [wrapped, instantiated, us, subst] as const;
	});

	const { result } = inference(ctx);
	return result;
};
