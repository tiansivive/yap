import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import { Either } from "fp-ts/lib/Either";

import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";

import { set, update } from "@yap/utils";

import * as Sub from "@yap/elaboration/unification/substitution";

import { Declaration, Interface } from "../modules/loading";
import * as A from "fp-ts/lib/Array";

import { type Constraint, type Resolutions } from "./solver";
import type { WithProvenance } from "./shared/provenance";

/*
 * The module driver is a true boundary: each statement elaborates under its
 * own run, and what must survive between statements — the metacontext and
 * the fresh-id counters — threads through the boundary state. Everything
 * else (constraints, provenance, mutable machine state) is per-statement.
 */
export type Boundary = {
	registry: Metas.Registry;
	counts: Partial<Record<"meta" | "var" | "skolem", number>>;
};

export const boundary: Boundary = { registry: Metas.empty, counts: {} };

const run = <A>(ctx: EB.Context, state: Boundary, program: () => M.Elaboration<A>): [Either<M.Err, A>, Boundary] => {
	const [answer, , , , , counts, registry] = Eff.run(program, [
		M.writer.handlers(),
		M.reader.handlers(ctx),
		M.except.handlers(),
		M.st.handlers({ delimitations: [], nondeterminism: { solution: {} } }),
		M.supply.handlers(state.counts),
		Metas.registry.handlers(state.registry),
		M.tracer.handlers(),
	]);

	const next: Boundary = { registry, counts };

	/* Concretely-typed narrowing: the generic A defeats Eff.failed's Aborted<unknown> predicate. */
	const failed = (a: A | Eff.Aborted<M.Err>): a is Eff.Aborted<M.Err> => Eff.failed(a);

	return [failed(answer) ? E.left(answer[Eff.ABORT]) : E.right(answer), next];
};

type InterfaceFields = Omit<Interface, "imports" | "zonker">;
type WithCtx = [InterfaceFields, EB.Context, Boundary];

export const elaborate = (mod: Src.Module, ctx: EB.Context, state: Boundary = boundary): Omit<Interface, "imports"> => {
	const maybeExport =
		(name: string) =>
		([result, c, s]: WithCtx): WithCtx => {
			if (
				mod.exports.type === "*" ||
				(mod.exports.type === "explicit" && mod.exports.names.includes(name)) ||
				(mod.exports.type === "partial" && !mod.exports.hiding.includes(name))
			) {
				return [update(result, "exports", A.append(name)), c, s];
			}
			return [result, c, s];
		};

	type Pair = [string, Either<M.Err, EB.AST>];
	const next = (stmts: Src.Statement[], ctx: EB.Context, state: Boundary): WithCtx => {
		if (stmts.length === 0) {
			return [{ foreign: [], exports: [], letdecs: [], errors: [], declarations: {} }, ctx, state];
		}

		const [head, ...tail] = stmts;

		if (head.type === "using") {
			const [result, nextState] = using(head, ctx, state);
			return F.pipe(
				result,
				E.match(
					e => {
						const [r, c, s] = next(tail, ctx, nextState);
						return [update(r, "errors", A.prepend(e)), c, s] satisfies WithCtx;
					},
					ctx => next(tail, ctx, nextState),
				),
			);
		}

		if (head.type === "foreign") {
			const [name, result, nextState] = foreign(head, ctx, state);
			return F.pipe(
				result,
				E.match(
					e => {
						const [r, c, s] = next(tail, ctx, nextState);
						return [update(r, "foreign", A.prepend<Pair>([name, E.left(e)])), c, s] satisfies WithCtx;
					},
					([ast, nextCtx, decl]) =>
						F.pipe(
							next(tail, nextCtx, nextState),
							([r, c, s]) =>
								[
									F.pipe(
										r,
										update("foreign", A.prepend<Pair>([name, E.right(ast)])),
										update("declarations", (d: Record<string, Declaration>) => ({ ...d, [name]: decl })),
									),
									c,
									s,
								] satisfies WithCtx,
							maybeExport(name),
						),
				),
			);
		}

		if (head.type === "let") {
			const [name, result, nextState] = letdec(head, ctx, state);

			return F.pipe(
				result,
				E.match(
					e => {
						const [r, c, s] = next(tail, ctx, nextState);
						return [update(r, "letdecs", A.prepend<Pair>([name, E.left(e)])), c, s] satisfies WithCtx;
					},
					([ast, nextCtx]) =>
						F.pipe(
							next(tail, nextCtx, nextState),
							([r, c, s]) => [update(r, "letdecs", A.prepend<Pair>([name, E.right(ast)])), c, s] satisfies WithCtx,
							maybeExport(name),
						),
				),
			);
		}

		console.warn("Unrecognized statement", head);
		return next(tail, ctx, state);
	};

	const [result, , finalState] = next(mod.content.script, ctx, state);
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
	return { ...result, zonker: Metas.solutions(finalState.registry) };
};

export const foreign = (
	stmt: Extract<Src.Statement, { type: "foreign" }>,
	ctx: EB.Context,
	state: Boundary = boundary,
): [string, Either<M.Err, [EB.AST, EB.Context, Declaration]>, Boundary] => {
	const [result, nextState] = run(ctx, state, function* () {
		const [tm, us] = yield* EB.check(stmt.annotation, NF.Type);
		const nf = yield* NF.evaluate(tm);
		const v = EB.Constructors.Var({ type: "Foreign", name: stmt.variable });
		const a = yield* NF.arity(nf);
		return [[v, nf, us], set(ctx, ["imports", stmt.variable] as const, [v, nf, us]), { arity: a, source: "ffi" }] satisfies [EB.AST, EB.Context, Declaration];
	});

	return [stmt.variable, result, nextState];
};

export const using = (stmt: Extract<Src.Statement, { type: "using" }>, ctx: EB.Context, state: Boundary = boundary): [Either<M.Err, EB.Context>, Boundary] => {
	type Implicit = EB.Context["implicits"][0];

	return run(ctx, state, function* () {
		const [t, ty] = yield* EB.Stmt.infer(stmt);
		const nf = yield* NF.whnf(t.value);
		return update(ctx, "implicits", A.append<Implicit>([nf, ty]));
	});
};

export const letdec = (
	stmt: Extract<Src.Statement, { type: "let" }>,
	ctx: EB.Context,
	state: Boundary = boundary,
): [string, Either<M.Err, [EB.AST, EB.Context]>, Boundary] => {
	const [result, nextState] = run(ctx, state, function* () {
		const [elaborated, , us] = yield* EB.Stmt.infer(stmt);
		const [r, next] = yield* EB.Stmt.letdec(elaborated as Extract<EB.Statement, { type: "Let" }>);

		const ast: EB.AST = [r.value, r.annotation, us];
		const final = [ast, set(next, ["imports", stmt.variable] as const, ast)] satisfies [EB.AST, EB.Context];
		console.warn("Verification skipped for letdec: ", stmt.variable, " Needs to be replaced by IVL solver");
		console.log("Elaborated letdec:", stmt.variable);
		return final;
	});

	return [stmt.variable, result, nextState];
};

export type ElaborationDebug = {
	constraints: WithProvenance<Constraint>[];
	zonker: Sub.Subst;
	resolutions: Resolutions;
};

export const expression = (stmt: Extract<Src.Statement, { type: "expression" }>, ctx: EB.Context, state: Boundary = boundary) => {
	return run(ctx, state, function* () {
		const [elaborated, ty, us] = yield* EB.infer(stmt.value);
		const { constraints } = yield* M.writer.peek();
		const { resolutions } = yield* EB.solve(constraints);

		const forced = yield* NF.force(ty);
		const [generalized] = yield* NF.generalize(forced, elaborated, resolutions);
		const instantiated = yield* NF.instantiate(generalized);

		const tm = yield* EB.Icit.wrapLambda(elaborated, instantiated);
		const wrapped = yield* EB.Icit.instantiate(tm, resolutions);

		const registry = yield* Metas.registry.get();
		const debug: ElaborationDebug = { constraints, zonker: Metas.solutions(registry), resolutions };
		return [wrapped, instantiated, us, ctx, debug] as const;
	});
};
