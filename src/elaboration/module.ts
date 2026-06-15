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
import * as A from "fp-ts/lib/Array";

import * as Sub from "@yap/elaboration/unification/substitution";
import { type Constraint, type Resolutions } from "./solver";
import type { WithProvenance } from "./shared/provenance";

type InterfaceFields = Omit<Interface, "imports" | "zonker">;
type WithCtx = [InterfaceFields, EB.Context];

export const elaborate = (mod: Src.Module, ctx: EB.Context): Omit<Interface, "imports"> => {
	const maybeExport =
		(name: string) =>
		([result, c]: WithCtx): WithCtx => {
			if (
				mod.exports.type === "*" ||
				(mod.exports.type === "explicit" && mod.exports.names.includes(name)) ||
				(mod.exports.type === "partial" && !mod.exports.hiding.includes(name))
			) {
				return [update(result, "exports", A.append(name)), c];
			}
			return [result, c];
		};

	type Pair = [string, Either<EB.V2.Err, EB.AST>];
	const next = (stmts: Src.Statement[], ctx: EB.Context): WithCtx => {
		if (stmts.length === 0) {
			return [{ foreign: [], exports: [], letdecs: [], errors: [], declarations: {} }, ctx];
		}

		const [head, ...tail] = stmts;

		if (head.type === "using") {
			return F.pipe(
				using(head, ctx),
				E.match(
					e => {
						const [r, c] = next(tail, ctx);
						return [update(r, "errors", A.prepend(e)), c] as WithCtx;
					},
					ctx => next(tail, ctx),
				),
			);
		}

		if (head.type === "foreign") {
			const [name, result] = foreign(head, ctx);
			return F.pipe(
				result,
				E.match(
					e => {
						const [r, c] = next(tail, ctx);
						return [update(r, "foreign", A.prepend<Pair>([name, E.left(e)])), c] as WithCtx;
					},
					([ast, nextCtx, decl]) =>
						F.pipe(
							next(tail, nextCtx),
							([r, c]) =>
								[
									F.pipe(
										r,
										update("foreign", A.prepend<Pair>([name, E.right(ast)])),
										update("declarations", (d: Record<string, Declaration>) => ({ ...d, [name]: decl })),
									),
									c,
								] as WithCtx,
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
					e => {
						const [r, c] = next(tail, ctx);
						return [update(r, "letdecs", A.prepend<Pair>([name, E.left(e)])), c] as WithCtx;
					},
					([ast, nextCtx]) =>
						F.pipe(next(tail, nextCtx), ([r, c]) => [update(r, "letdecs", A.prepend<Pair>([name, E.right(ast)])), c] as WithCtx, maybeExport(name)),
				),
			);
		}

		console.warn("Unrecognized statement", head);
		return next(tail, ctx);
	};

	const [result, finalCtx] = next(mod.content.script, ctx);
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
	return { ...result, zonker: finalCtx.zonker };
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
		const [elaborated, , us] = yield* EB.Stmt.infer.gen(stmt);
		const [r, next] = yield* EB.Stmt.letdec(elaborated as Extract<EB.Statement, { type: "Let" }>);

		const ast: EB.AST = [r.value, r.annotation, us];
		const final = [ast, set(next, ["imports", stmt.variable] as const, ast)] satisfies [EB.AST, EB.Context];
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
