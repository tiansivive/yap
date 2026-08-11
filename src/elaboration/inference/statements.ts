import * as Src from "@yap/src/index";
import * as EB from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";

import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as F from "fp-ts/lib/function";
import * as R from "fp-ts/lib/Record";

import { match } from "ts-pattern";
import { freshMeta } from "@yap/elaboration/shared/supply";

import * as Sub from "@yap/elaboration/unification/substitution";
import { compose } from "@yap/elaboration/unification/substitution";
import { update } from "@yap/utils";
import { replay } from "../solver/nondeterminism";
import { unify } from "../unification";

export type ElaboratedStmt = [EB.Statement, NF.Value, Q.Usages];
export const infer = (stmt: Src.Statement): M.Elaboration<ElaboratedStmt> =>
	M.tracer.track({ tag: "src", type: "stmt", stmt, metadata: { action: "infer", description: "Statement" } }, () =>
		match(stmt)
			.with({ type: "let" }, function* (dec) {
				const ctx = yield* M.reader.ask();

				const ann = dec.annotation
					? yield* EB.check(dec.annotation, NF.Type)
					: ([EB.Constructors.Var(yield* freshMeta(ctx.env.length, NF.Type)), Q.noUsage(ctx.env.length)] as const);
				const va = yield* NF.normalize(ann[0]);

				const inferred = yield* M.reader.local(
					_ctx => EB.bind(_ctx, { type: "Let", variable: dec.variable }, va),
					(function* () {
						const inferred = yield* EB.check(dec.value, va);
						const [bTerm, [_vu, ...bus]] = inferred;
						//yield* M.constrain({ type: "usage", expected: q, computed: vu });

						return [bTerm, va, bus] satisfies EB.AST; // remove the usage of the bound variable (same as the lambda rule)
					})(),
				);

				// TODO(post-migration): recursive type-level lets are not wrapped in Mu right now.
				// Agreed approach: no upward channel needed — wrap when va == Type and the elaborated
				// body self-references (occurs-check for Var{Bound, index == depth} on inferred[0]).
				// This drops v2's support for self-reference inside type annotations of value-level
				// lets, which we consider degenerate and do not want to allow.
				// v2 did it via the writer's binder channel:
				// const { binders } = yield* V2.listen();
				// const tm = binders.find(b => b.type === "Mu" && b.variable === dec.variable)
				// 	? EB.Constructors.Mu("x", dec.variable, ann[0], inferred[0])
				// 	: inferred[0];
				const tm = inferred[0];
				const def = EB.Constructors.Stmt.Let(dec.variable, tm, va);
				return [def, inferred[1], inferred[2]] satisfies ElaboratedStmt;
			})
			.with({ type: "expression" }, function* ({ value }) {
				const [expr, ty, us] = yield* EB.infer(value);
				return [EB.Constructors.Stmt.Expr(expr), ty, us] satisfies ElaboratedStmt;
			})
			.with({ type: "using" }, function* ({ value }) {
				const [tm, ty, us] = yield* EB.infer(value);
				return [{ type: "Using", value: tm, annotation: ty }, ty, us] satisfies ElaboratedStmt;
			})
			.otherwise(() => {
				throw new Error("Not implemented yet");
			}),
	);

export const letdec = function* (dec: Extract<EB.Statement, { type: "Let" }>): M.Elaboration<[Extract<EB.Statement, { type: "Let" }>, EB.Context]> {
	const ctx = yield* M.reader.ask();
	const { constraints } = yield* M.writer.peek();
	const registry = yield* Metas.registry.get();
	const metas = yield* Metas.asContext(registry);
	const withMetas = update(ctx, "metas", prev => ({ ...prev, ...metas }));

	const _letdec = (z: Record<number, NF.Value>) =>
		(function* (): M.Elaboration<[NF.Value, EB.Context, EB.Resolutions, boolean]> {
			const nondet = update(withMetas, "zonker", old => ({ ...old, ...z }));

			const { zonker, resolutions } = yield* M.reader.local(_ => nondet, EB.solve(constraints));
			const postSolve = yield* Metas.registry.get();
			const postMetas = yield* Metas.asContext(postSolve);
			const withAllMetas = update(withMetas, "metas", prev => ({ ...prev, ...postMetas }));
			const zonked = update(withAllMetas, "zonker", z => compose(zonker, z));

			const [generalized, subst, introduced] = NF.generalize(
				yield* M.reader.local(_ => zonked, NF.force(dec.annotation)),
				dec.value,
				EB.bind(zonked, { type: "Let", variable: dec.variable }, dec.annotation),
				resolutions,
			);
			const next = update(zonked, "zonker", z => compose(subst, z));
			const instantiated = NF.instantiate(generalized, EB.bind(next, { type: "Let", variable: dec.variable }, generalized));
			return [instantiated, next, resolutions, introduced];
		})();

	// Extend again now that we have the generalized type
	// Use the zonked context to avoid issues with the already generalized metas

	const st = yield* M.st.get();
	const [[instantiated, next, resolutions, introduced], ...rest] = R.isEmpty(st.nondeterminism.solution) ? [yield* _letdec({})] : yield* replay(_letdec);

	let final = next;
	for (const [type] of rest) {
		const solution = yield* unify(instantiated, type, next.env.length, Sub.empty);
		final = update(final, "zonker", z => compose(solution, z));
	}

	const xtended = EB.bind(next, { type: "Let", variable: dec.variable }, instantiated);
	const wrapped = F.pipe(introduced ? EB.Icit.wrapLambda(dec.value, instantiated, xtended) : dec.value, tm => EB.Icit.instantiate(tm, xtended, resolutions));

	const statement = EB.Constructors.Stmt.Let(dec.variable, wrapped, instantiated);
	return [statement, next] as [Extract<EB.Statement, { type: "Let" }>, EB.Context];
};
