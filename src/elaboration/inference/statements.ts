import * as Src from "@yap/src/index";
import * as EB from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/monad";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as F from "fp-ts/lib/function";

import { match } from "ts-pattern";
import { freshMeta } from "@yap/elaboration/shared/supply";

export type ElaboratedStmt = [EB.Statement, NF.Value, Q.Usages];
export const infer = (stmt: Src.Statement): V2.Elaboration<ElaboratedStmt> =>
	V2.track(
		{ tag: "src", type: "stmt", stmt, metadata: { action: "infer", description: "Statement" } },
		(() =>
			match(stmt)
				.with({ type: "let" }, letdec =>
					V2.Do(function* () {
						const ctx = yield* V2.ask();
						const ann = letdec.annotation
							? yield* EB.check.gen(letdec.annotation, NF.Type)
							: ([EB.Constructors.Var(yield* freshMeta(ctx.env.length, NF.Type)), Q.noUsage(ctx.env.length)] as const);
						const va = NF.evaluate(ctx, ann[0]);
						const q = letdec.multiplicity || Q.Many;

						const inferred = yield* V2.local(
							_ctx => EB.bind(_ctx, { type: "Let", variable: letdec.variable }, [va, q]),
							V2.Do(function* () {
								const inferred = yield* EB.check.gen(letdec.value, va);
								const [bTerm, [vu, ...bus]] = inferred;
								yield* V2.tell("constraint", { type: "usage", expected: q, computed: vu });

								return [bTerm, va, bus] satisfies EB.AST; // remove the usage of the bound variable (same as the lambda rule)
							}),
						);
						const { binders, constraints } = yield* V2.listen();

						// TODO: This binders array is not overly useful for now
						// // In theory, all we need is to emit a flag signalling the letdec var has been used
						// FIXME: We should really leverage the `check` function to understand when to wrap in a mu
						const tm = binders.find(b => b.type === "Mu" && b.variable === letdec.variable)
							? EB.Constructors.Mu("x", letdec.variable, ann[0], inferred[0])
							: inferred[0];
						const def = EB.Constructors.Stmt.Let(letdec.variable, tm, ann[0]);
						return [def, inferred[1], inferred[2]] satisfies ElaboratedStmt;
					}),
				)
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
