import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/monad";
import * as CST from "@yap/cst";

import _ from "lodash";

import * as tmp from "./tmp";
import * as Pi from "./pi";
import * as Struct from "./struct";
import * as Match from "./match";
import * as Modal from "./modal";
import * as Row from "./row";
import { SyntaxType } from "@yap/cst/types/generated";
import assert from "node:assert";

type Result = EB.Term;

export const check = (node: CST.Types.SyntaxNode, type: NF.Value): M.Elaboration<Result> =>
    M.track(
        { tag: "src", type: "ts-node", node, metadata: { action: "checking", against: type } },
        M.Do(function* () {
            const ctx = yield* M.ask();

            const result = match([node, type])
                .with([{ type: SyntaxType.Hole }, P._], function* () {

                    const k = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
                    return EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, k));
                })

                .with(
                    [{ type: SyntaxType.Lambda }, { type: "Abs", binder: { type: "Pi" } }],

                    ([lambda, pi]) => {

                        const { explicit, implicit } = CST.Utils.extractFields(lambda, "explicit", "implicit");


                        const icitValue = explicit ? "Explicit" : implicit ? "Implicit" : (() => { throw new Error("Lambda must have either explicit or implicit parameters") })();
                        return icitValue === pi.binder.icit;
                    },
                    function* ([lambda, pi]) {
                        const { params, icit } = CST.Utils.extractFields(lambda, "params", "icit");

                        const fold = function* (params: CST.Types.SyntaxNode[], type: NF.Value): M.Gelaboration<EB.Term> {

                            match(type)
                                .with({ type: "Abs", binder: { type: "Pi" } }, function* (ty) {
                                    const [param, ...rest] = params;
                                    assert(param, "Parameter expected");
                                })
                                .otherwise(() => {
                                    const p = params.childForFieldName("param");
                                    const bType = NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(ctx.env.length));

                                    return 1 as any;

                                }


                        
                        const ann = tm.annotation
                                ? (yield* EB.check.gen(tm.annotation, pi.binder.annotation))[0]
                                : NF.quote(ctx, ctx.env.length, pi.binder.annotation);
                        },
                )
                .with(
                    [P._, { type: "Abs", binder: { type: "Pi" } }],
                    ([_, ty]) => ty.binder.icit === "Implicit",
                    ([_, ty]) => Pi.insertImplicit(node, ty),
                )

                .with(["variant", NF.Patterns.Type], () =>
                    M.Do(function* () {
                        const { field: fields, tail } = CST.Utils.extractFields(node, ["field"], "tail");
                        const r = yield* Row.check(fields, tail as CST.Types.IdentifierNode | undefined, NF.Type, ctx.env.length);
                        return EB.Constructors.Variant(r);
                    }),
                )
                .with(["tuple", NF.Patterns.Type], () =>
                    M.Do(function* () {
                        const { element: elements, tail } = CST.Utils.extractFields(node, ["element"], "tail");
                        // Convert tuple elements to labeled fields (0, 1, 2, ...)
                        const labeled = elements.map((elem, idx) => ({ label: idx.toString(), node: elem }));
                        const r = yield* Row.check(labeled.map(l => l.node), tail as CST.Types.IdentifierNode | undefined, NF.Type, ctx.env.length);
                        return EB.Constructors.Schema(r);
                    }),
                )
                .with(["struct", NF.Patterns.Type], () =>
                    M.Do(function* () {
                        const { field: fields, tail } = CST.Utils.extractFields(node, ["field"], "tail");
                        const r = yield* Row.check(fields, tail as CST.Types.IdentifierNode | undefined, NF.Type, ctx.env.length);

                        const sigma = EB.Constructors.Sigma("$sig", EB.Constructors.Row(r), EB.Constructors.Schema(r));
                        return sigma;
                    }),
                )

                .with(["tagged", NF.Patterns.Type], () =>
                    M.Do(function* () {
                        const { tag, payload } = CST.Utils.extractFields(node, "tag", "payload");
                        const tm = yield* tmp.check(payload, type);
                        const checked = yield* tmp.check(payload, type);

                        return EB.Constructors.Inj(tag.text, tm, checked);
                    }),
                )

                .with(["struct", NF.Patterns.HashMap], ([_, hashmap]) => Struct.checkHashMap(node as CST.Types.StructNode, hashmap))
                .with(["struct", NF.Patterns.Schema], ([_, val]) => Struct.checkSchema(node as CST.Types.StructNode, val))
                .with(["struct", NF.Patterns.Sigma], ([_, sig]) => Struct.checkSigma(node as CST.Types.StructNode, sig))

                .with(["match", NF.Patterns.Type], ([_, ty]) => Match.checkType(node as CST.Types.MatchNode, ty))
                .with(["match", P._], ([_, ty]) => Match.check(node as CST.Types.MatchNode, ty))

                .with(
                    ["number", { type: "Lit", value: { type: "Num" } }],
                    ([_, val]) => {
                        if (node.type !== "number") return false;
                        return Number(node.text) === val.value.value;
                    },
                    () => M.of(EB.Constructors.Lit({ type: "Num", value: Number(node.text) })),
                )
                .with(["number", NF.Patterns.Type], () => {
                    return M.of(EB.Constructors.Lit({ type: "Num", value: Number(node.text) }));
                })

                .with([P._, { type: "Modal" }], ([_, val]) => tmp.check(node, val.value))
                .with(["modal", P._], ([_, val]) => Modal.check(node as CST.Types.ModalNode, val))

                .otherwise(([_, ty]) =>
                    M.Do(() =>
                        M.local(
                            ctx => (_.isEqual(ty, NF.Type) ? EB.muContext(ctx) : ctx),
                            M.Do(function* () {
                                const inferModule = yield* import("../inference.v2/tmp");
                                const [tm, inferred] = yield* inferModule.infer(node);
                                const [inserted] = yield* EB.Icit.insert.gen([tm, inferred]);
                                yield* M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
                                return inserted;
                            }),
                        ),
                    ),
                );

            //const tm = yield* M.pure(result);
            return 1 as any;
        }),
    );

