import * as Src from "@yap/src/index";
import * as EB from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";

import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as F from "fp-ts/lib/function";

import { match } from "ts-pattern";
import { freshMeta } from "@yap/elaboration/shared/supply";

import * as Modal from "@yap/verification/modalities";
import { compose } from "@yap/elaboration/unification/substitution";
import { set, update } from "@yap/utils";

export type ElaboratedStmt = [EB.Statement, NF.Value, Q.Usages];
export const infer = (stmt: Src.Statement): V2.Elaboration<ElaboratedStmt> =>
	V2.track(
		{ tag: "src", type: "stmt", stmt, metadata: { action: "infer", description: "Statement" } },
		(() =>
			match(stmt)
				.with({ type: "let" }, dec => {
					return V2.Do(function* () {
						const ctx = yield* V2.ask();

						const ann = dec.annotation
							? yield* EB.check.gen(dec.annotation, NF.Type)
							: ([EB.Constructors.Var(yield* freshMeta(ctx.env.length, NF.Type)), Q.noUsage(ctx.env.length)] as const);
						const va = NF.evaluate(ctx, ann[0]);

						const inferred = yield* V2.local(
							_ctx => EB.bind(_ctx, { type: "Let", variable: dec.variable }, va),
							V2.Do(function* () {
								const inferred = yield* EB.check.gen(dec.value, va);
								const [bTerm, [vu, ...bus]] = inferred;
								//yield* V2.tell("constraint", { type: "usage", expected: q, computed: vu });

								return [bTerm, va, bus] satisfies EB.AST; // remove the usage of the bound variable (same as the lambda rule)
							}),
						);
						const { binders } = yield* V2.listen();

						// TODO: This binders array is not overly useful for now
						// // In theory, all we need is to emit a flag signalling the letdec var has been used
						// FIXME: We should really leverage the `check` function to understand when to wrap in a mu
						const tm = binders.find(b => b.type === "Mu" && b.variable === dec.variable)
							? EB.Constructors.Mu("x", dec.variable, ann[0], inferred[0])
							: inferred[0];
						const def = EB.Constructors.Stmt.Let(dec.variable, tm, va);
						return [def, inferred[1], inferred[2]] satisfies ElaboratedStmt;
					});
				})
				.with({ type: "expression" }, ({ value }) =>
					V2.Do(function* () {
						const [expr, ty, us] = yield* EB.infer.gen(value);
						return [EB.Constructors.Stmt.Expr(expr), ty, us] satisfies ElaboratedStmt;
					}),
				)
				.with({ type: "using" }, ({ value }) =>
					V2.Do(function* () {
						const [tm, ty, us] = yield* EB.infer.gen(value);
						return [{ type: "Using", value: tm, annotation: ty }, ty, us] satisfies ElaboratedStmt;
					}),
				)
				.otherwise(() => {
					throw new Error("Not implemented yet");
				}))(),
	);

infer.gen = F.flow(infer, V2.pure);

export const letdec = function* (
	dec: Extract<EB.Statement, { type: "Let" }>,
): Generator<V2.Elaboration<any>, [Extract<EB.Statement, { type: "Let" }>, EB.Context], any> {
	const ctx = yield* V2.ask();

	const { constraints, metas } = yield* V2.listen();
	const withMetas = update(ctx, "metas", prev => ({ ...prev, ...metas }));
	const { zonker, resolutions } = yield* V2.local(_ => withMetas, EB.solve(constraints));
	const zonked = update(withMetas, "zonker", z => compose(zonker, z));

	const [generalized, subst] = NF.generalize(NF.force(zonked, dec.annotation), EB.bind(zonked, { type: "Let", variable: dec.variable }, dec.annotation));
	const next = update(zonked, "zonker", z => ({ ...z, ...subst }));

	const instantiated = NF.instantiate(generalized, EB.bind(next, { type: "Let", variable: dec.variable }, generalized));

	// Extend again now that we have the generalized type
	// Use the zonked context to avoid issues with the already generalized metas
	const xtended = EB.bind(next, { type: "Let", variable: dec.variable }, instantiated);
	const wrapped = F.pipe(
		EB.Icit.wrapLambda(dec.value, instantiated, xtended),
		tm => EB.Icit.instantiate(tm, xtended, resolutions),
		// inst => EB.Icit.generalize(inst, xtended),
	);

	const statement = EB.Constructors.Stmt.Let(dec.variable, wrapped, instantiated);
	return [statement, next] as [Extract<EB.Statement, { type: "Let" }>, EB.Context];
};
