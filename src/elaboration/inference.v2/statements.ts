import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/elaboration/normalization";

import * as F from "fp-ts/lib/function";
import * as R from "fp-ts/lib/Record";

import { match } from "ts-pattern";
import { freshMeta } from "@yap/elaboration/shared/supply";

import * as Sub from "@yap/elaboration/unification/substitution";
import { compose } from "@yap/elaboration/unification/substitution";
import { update } from "@yap/utils";
import { replay } from "../solver/nondeterminism";
import { unify } from "../unification";

import * as tmp from "./tmp";
import { SyntaxType } from "@yap/cst/types/generated";

export type ElaboratedStmt = [EB.Statement, NF.Value];

export const infer = (node: CST.Types.SyntaxNode): M.Elaboration<ElaboratedStmt> =>
    M.track(
        { tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Statement" } },
        (() =>
            match(node)
                .with({ type: SyntaxType.Letdec }, (dec) => {
                    return M.Do(function* () {
                        const ctx = yield* M.ask();

                        const { name, type, value } = CST.Utils.extractFields(
                            dec,
                            "name",
                            "value",
                            "type",
                        );

                        const ann = type
                            ? yield* tmp.check(type, NF.Type)
                            : EB.Constructors.Var(yield* freshMeta(ctx.env.length, NF.Type));
                        const va = NF.evaluate(ctx, ann);

                        const varname = name.text;

                        const inferred = yield* M.local(
                            _ctx => EB.bind(_ctx, { type: "Let", variable: varname }, va),
                            M.Do(function* () {
                                const bTerm = yield* tmp.check(value, va);

                                return [bTerm, va] satisfies [EB.Term, NF.Value];
                            }),
                        );
                        const { binders } = yield* M.listen();

                        // TODO: This binders array is not overly useful for now
                        // // In theory, all we need is to emit a flag signalling the letdec var has been used
                        // FIXME: We should really leverage the `check` function to understand when to wrap in a mu
                        const tm = binders.find(b => b.type === "Mu" && b.variable === varname)
                            ? EB.Constructors.Mu("x", varname, ann, inferred[0])
                            : inferred[0];
                        const def = EB.Constructors.Stmt.Let(varname, tm, va);
                        return [def, inferred[1]] satisfies ElaboratedStmt;
                    });
                })
                .with({ type: SyntaxType.Using }, (node) =>
                    M.Do(function* () {
                        const { expression } = CST.Utils.extractFields(node, "expression");
                        const [tm, ty] = yield* tmp.infer(expression);
                        return [{ type: "Using", value: tm, annotation: ty }, ty] satisfies ElaboratedStmt;
                    }),
                )
                .otherwise(expr =>
                    M.Do(function* () {

                        const [tm, ty] = yield* tmp.infer(expr);
                        return [EB.Constructors.Stmt.Expr(tm), ty] satisfies ElaboratedStmt;
                    })
                )
        )(),

        // .otherwise(() => {
        //     throw new Error(`Statement type ${node.type} not implemented yet`);
        // }))(),
    );

export const letdec = function* (
    dec: Extract<EB.Statement, { type: "Let" }>,
): Generator<M.Elaboration<any>, [Extract<EB.Statement, { type: "Let" }>, EB.Context], any> {
    const ctx = yield* M.ask();
    const { constraints, metas } = yield* M.listen();
    const withMetas = update(ctx, "metas", prev => ({ ...prev, ...metas }));

    const _letdec = (z: Record<number, NF.Value>, skolems: M.MutState["skolems"]) =>
        M.Do(function* (): Generator<M.Elaboration<any>, [NF.Value, EB.Context, EB.Resolutions], any> {
            const nondet = update(withMetas, "zonker", old => ({ ...old, ...z }));

            const { zonker, resolutions } = yield* M.local(_ => nondet, EB.solve(constraints));
            const zonked = update(withMetas, "zonker", z => compose(zonker, z));

            const [generalized, subst] = NF.generalize(
                NF.force(zonked, dec.annotation),
                dec.value,
                EB.bind(zonked, { type: "Let", variable: dec.variable }, dec.annotation),
                resolutions,
                skolems,
            );
            const next = update(zonked, "zonker", z => compose(subst, z));
            const instantiated = NF.instantiate(
                generalized,
                EB.bind(next, { type: "Let", variable: dec.variable }, generalized),
            );
            return [instantiated, next, resolutions];
        });

    const st = yield* M.getSt();

    const [[instantiated, next, resolutions], ...rest] = R.isEmpty(st.nondeterminism.solution)
        ? [yield _letdec({}, {})]
        : yield* replay(_letdec);

    let final = next;
    for (const [type] of rest) {
        const solution = yield* unify.gen(instantiated, type, next.env.length, Sub.empty);
        final = update(final, "zonker", z => compose(solution, z));
    }

    const xtended = EB.bind(next, { type: "Let", variable: dec.variable }, instantiated);
    const wrapped = F.pipe(
        EB.Icit.wrapLambda(dec.value, instantiated, xtended),
        tm => EB.Icit.instantiate(tm, xtended, resolutions),
    );

    const statement = EB.Constructors.Stmt.Let(dec.variable, wrapped, instantiated);
    return [statement, next] as [Extract<EB.Statement, { type: "Let" }>, EB.Context];
};
