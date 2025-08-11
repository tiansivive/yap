import * as Src from "@yap/src/index";
import * as EB from "@yap/elaboration";

import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/monad";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as F from "fp-ts/lib/function";

import { match } from "ts-pattern";
import { freshMeta } from "@yap/elaboration/shared/supply";

export type ElaboratedStmt = [EB.Statement, NF.Value, Q.Usages];
export const infer = (stmt: Src.Statement): M.Elaboration<ElaboratedStmt> => {
	return match(stmt)
		.with({ type: "let" }, letdec => {
			return F.pipe(
				M.Do,
				M.let("ctx", M.ask()),
				M.bind("ann", ({ ctx }) =>
					letdec.annotation
						? EB.check(letdec.annotation, NF.Type)
						: M.of([EB.Constructors.Var(freshMeta(ctx.env.length, NF.Type)), Q.noUsage(ctx.env.length)] as const),
				),
				M.bind("inferred", ({ ctx, ann }) => {
					const va = NF.evaluate(ctx, ann[0]);
					const q = letdec.multiplicity || Q.Many;
					const ctx_ = EB.bind(ctx, { type: "Let", variable: letdec.variable }, [va, q]);
					return M.local(
						ctx_,
						F.pipe(
							EB.check(letdec.value, va),
							M.fmap(([tm, us]): EB.AST => [tm, va, us]),
							M.discard(([, , [vu]]) => M.tell("constraint", { type: "usage", expected: q, computed: vu })),
							// remove the usage of the bound variable (same as the lambda rule)
							M.fmap(([tm, ty, [, ...us]]): EB.AST => [tm, ty, us]),
						),
					);
				}),
				M.listen(([{ inferred, ann }, { binders, constraints }]): ElaboratedStmt => {
					// TODO: This binders array is not overly useful for now
					// // In theory, all we need is to emit a flag signalling the letdec var has been used
					// FIXME: We should really leverage the `check` function to understand when to wrap in a mu
					const tm = binders.find(b => b.type === "Mu" && b.variable === letdec.variable)
						? EB.Constructors.Mu("x", letdec.variable, ann[0], inferred[0])
						: inferred[0];

					const def = EB.Constructors.Stmt.Let(letdec.variable, tm, ann[0]);
					return [def, inferred[1], inferred[2]];
				}),
			);
		})
		.with({ type: "expression" }, ({ value }) => M.fmap(EB.infer(value), (expr): ElaboratedStmt => [EB.Constructors.Stmt.Expr(expr[0]), expr[1], expr[2]]))

		.with({ type: "using" }, ({ value }) => {
			return F.pipe(
				EB.infer(value),
				M.fmap(([tm, ty, us]): ElaboratedStmt => [{ type: "Using", value: tm, annotation: ty }, ty, us]),
			);
		})
		.otherwise(() => {
			throw new Error("Not implemented yet");
		});
};
