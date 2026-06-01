import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as Q from "@yap/shared/modalities/multiplicity";

import { Either } from "fp-ts/lib/Either";

import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";

import { set, update } from "@yap/utils";

import { Declaration, Interface } from "../modules/loading";
import { solve } from "./solver";
import * as A from "fp-ts/lib/Array";

import * as Sub from "@yap/elaboration/unification/substitution";
import { type Constraint, type Resolutions } from "./solver";
import { VerificationServiceV2 } from "@yap/verification/V2/service";
import { match } from "ts-pattern";
import { Bool, Expr, init, Model } from "z3-solver";
import { getZ3Context } from "@yap/shared/config/options";
import type { WithProvenance } from "./shared/provenance";

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
			return { foreign: [], exports: [], letdecs: [], errors: [], declarations: {} };
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
					([ast, ctx, decl]) =>
						F.pipe(
							next(tail, ctx),
							update("foreign", A.prepend<Pair>([name, E.right(ast)])),
							update("declarations", (d: Record<string, Declaration>) => ({ ...d, [name]: decl })),
							maybeExport(name),
						),
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

export const foreign = (stmt: Extract<Src.Statement, { type: "foreign" }>, ctx: EB.Context): [string, Either<V2.Err, [EB.AST, EB.Context, Declaration]>] => {
	const check = EB.check(stmt.annotation, NF.Type);
	const [{ result }] = check(ctx);
	const e = E.Functor.map(result, ([tm, us]): [EB.AST, EB.Context, Declaration] => {
		const nf = NF.evaluate(ctx, tm);
		const v = EB.Constructors.Var({ type: "Foreign", name: stmt.variable });
		const a = NF.arity(ctx, nf);
		return [[v, nf, us], set(ctx, ["imports", stmt.variable] as const, [v, nf, us]), { arity: a, source: "ffi" }];
	});

	return [stmt.variable, e];
};

export const using = (stmt: Extract<Src.Statement, { type: "using" }>, ctx: EB.Context): Either<V2.Err, EB.Context> => {
	const infer = EB.Stmt.infer(stmt);
	const [{ result }] = infer(ctx);
	type Implicit = EB.Context["implicits"][0];
	return E.Functor.map(result, ([t, ty]) => update(ctx, "implicits", A.append<Implicit>([t.value, ty])));
};

export const letdec = (stmt: Extract<Src.Statement, { type: "let" }>, ctx: EB.Context): [string, Either<V2.Err, [EB.AST, EB.Context]>] => {
	const inference = V2.Do(function* () {
		const [elaborated, ty, us] = yield* EB.Stmt.infer.gen(stmt);
		// console.log("\n------------------ LETDEC --------------------------------");
		const [r, next] = yield* EB.Stmt.letdec(elaborated as Extract<EB.Statement, { type: "Let" }>);

		const zCtx = getZ3Context();
		if (!zCtx) {
			throw new Error("Z3 context not set");
		}
		const ast: EB.AST = [r.value, r.annotation, us];
		const final = [ast, set(next, ["imports", stmt.variable] as const, ast)] satisfies [EB.AST, EB.Context];
		// const Verification = VerificationServiceV2(zCtx, { logging: stmt.variable === "ascending" });
		// const xtended = EB.bind(next, { type: "Let", variable: stmt.variable }, ty);
		// try {
		// 	const [{ result: res }] = Verification.check(r.value, r.annotation)(xtended);

		// 	if (res._tag === "Left") {
		// 		console.log("Verification failure");
		// 		console.log(res.left);

		// 		return final;
		// 	}
		// 	const artefacts = res.right;

		// 	const solver = new zCtx.Solver();

		// 	solver.add(artefacts.vc.eq(true));
		// 	solver
		// 		.check()
		// 		.then(res => {
		// 			if (res === "sat") {
		// 				return [];
		// 			}

		// 			console.log("\nCould not verify obligations for dec: ", stmt.variable);
		// 			console.log(artefacts.vc.sexpr());
		// 			const obligations = Verification.getObligations?.() ?? [];
		// 			return Promise.all(
		// 				obligations.map(async ({ label, expr, context }) => {
		// 					const s = new zCtx.Solver();
		// 					s.add(expr.eq(true));
		// 					const r = await s.check();
		// 					let model: Model | undefined;
		// 					if (r === "unsat") {
		// 						// Try to extract a counterexample by solving the negation
		// 						const neg = new zCtx.Solver();
		// 						// Negate obligation by equating it to false to obtain a witness
		// 						neg.add(expr.eq(false));
		// 						const rn = await neg.check();
		// 						if (rn === "sat") {
		// 							model = neg.model();
		// 						}
		// 					}
		// 					return { label, result: r, expr, model, context };
		// 				}),
		// 			);
		// 		})
		// 		.then(async rs => {
		// 			rs.forEach(({ label, result, expr, model, context }, i) => {
		// 				console.log(` - [${result}] ${label}`);
		// 				if (context) {
		// 					if (context.description) {
		// 						if (Array.isArray(context.description)) {
		// 							console.log(`   description:`);
		// 							for (const line of context.description) {
		// 								console.log(`     ${line}`);
		// 							}
		// 						} else {
		// 							console.log(`   description: ${context.description}`);
		// 						}
		// 					}

		// 					if (context.term) {
		// 						console.log(`   term: ${context.term}`);
		// 					}

		// 					if (context.type) {
		// 						console.log(`   type: ${context.type}`);
		// 					}
		// 				}
		// 				if (result === "unsat") {
		// 					//console.log("   expr:", expr.sexpr());
		// 					if (model) {
		// 						// Try to extract variable values from the model
		// 						console.log("   counterexample:");
		// 						const decls = model.decls();
		// 						if (decls && decls.length > 0) {
		// 							for (const decl of decls) {
		// 								const name = decl.name();
		// 								const value = model.get(decl);
		// 								console.log(`     ${name} = ${value}`);
		// 							}
		// 						} else {
		// 							// Fallback: print the entire model
		// 							console.log("     ", model.sexpr());
		// 						}
		// 					}
		// 				}
		// 			});
		// 		});
		// } catch (e) {
		// 	console.log(`Verification error in letdec ${stmt.variable}`);
		// 	console.log(e);
		// 	return final;
		// }
		console.warn("Verification skipped for letdec: ", stmt.variable, " Needs to be replaced by IVL solver");
		console.log("Elaborated letdec:", stmt.variable);
		return final;
	});

	const [{ result }] = inference(ctx);
	return [stmt.variable, result];
};

export type ElaborationDebug = {
	constraints: WithProvenance<Constraint>[];
	zonker: Sub.Subst;
	resolutions: Resolutions;
};

export type VerificationResult = {
	vc?: Expr;
	result?: "sat" | "unsat" | "unknown";
	obligations?: Array<{ label: string; result: string; expr?: Expr; context?: { term?: string; type?: string; description?: string | string[] } }>;
	error?: string;
};

export const expression = (stmt: Extract<Src.Statement, { type: "expression" }>, ctx: EB.Context) => {
	const inference = V2.Do(function* () {
		const [elaborated, ty, us] = yield* EB.infer.gen(stmt.value);
		const { constraints, metas, zonker: toldZonker } = yield* V2.listen();
		const withMetas = update(ctx, "metas", prev => ({ ...prev, ...metas }));
		const { zonker, resolutions } = yield* V2.local(_ => withMetas, EB.solve(constraints));
		const { metas: postSolveMetas } = yield* V2.listen();
		const withAllMetas = update(withMetas, "metas", prev => ({ ...prev, ...postSolveMetas }));
		const zonked = update(withAllMetas, "zonker", z => Sub.compose(zonker, Sub.compose(toldZonker, z)));

		const [generalized, subst] = NF.generalize(NF.force(zonked, ty), elaborated, zonked, resolutions);
		const next = update(zonked, "zonker", z => ({ ...z, ...subst }));
		const instantiated = NF.instantiate(generalized, next);

		const wrapped = F.pipe(EB.Icit.wrapLambda(elaborated, instantiated, next), tm => EB.Icit.instantiate(tm, next, resolutions));

		const debug: ElaborationDebug = { constraints, zonker, resolutions };
		return [wrapped, instantiated, us, next, debug] as const;
	});

	const [{ result }] = inference(ctx);
	return result;
};

export const verify = async (term: EB.Term, type: NF.Value, ctx: EB.Context): Promise<VerificationResult | undefined> => {
	const zCtx = getZ3Context();

	if (!zCtx) {
		return { error: "Z3 context not set" };
	}

	console.warn("Verification skipped for expression. Needs to be replaced by IVL solver");

	// try {
	// 	const Verification = VerificationServiceV2(zCtx, {});
	// 	const [{ result: res }] = Verification.check(term, type)(ctx);

	// 	if (res._tag === "Left") {
	// 		return { error: `Verification failure: ${V2.display(res.left)}` };
	// 	}

	// 	const artefacts = res.right;
	// 	const vc = artefacts.vc;
	// 	const allObligations = Verification.getObligations();
	// 	const obligations = allObligations.map(({ label, expr, context }) => ({ label, result: "pending", expr, context }));

	// 	const solver = new zCtx.Solver();
	// 	solver.add(artefacts.vc.eq(true));
	// 	const solverResult = (await solver.check()) as "sat" | "unsat" | "unknown";

	// 	if (solverResult !== "sat") {
	// 		await Promise.all(
	// 			allObligations.map(async ({ label, expr, context }, i) => {
	// 				const s = new zCtx.Solver();
	// 				s.add(expr.eq(true));
	// 				obligations[i].result = await s.check();
	// 			}),
	// 		);
	// 	} else {
	// 		obligations.forEach(o => {
	// 			o.result = "sat";
	// 		});
	// 	}

	// 	return { vc, result: solverResult, obligations };
	// } catch (e) {
	// 	return { error: e instanceof Error ? e.message : String(e) };
	// }
};
