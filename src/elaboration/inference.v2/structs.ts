import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/elaboration/normalization";

import * as R from "@yap/shared/rows";
import * as CST from "@yap/cst";

import * as tmp from "./tmp";
import { withSigmaCtx } from "./sigma";
import { collect } from "./rows";
import assert from "node:assert";

type StructNode = Extract<CST.Types.SyntaxNode, { type: "struct" }>;

export const infer = (struct: StructNode): M.Elaboration<tmp.Typing> =>
    M.track(
        { tag: "src", type: "ts-node", node: struct, metadata: { action: "infer", description: "Struct" } },
        M.Do(function* () {
            const { field: fields, tail } = CST.Utils.extractFields(struct, ["field"], "tail");

            if (fields.some(f => f.type !== "key_value")) {
                throw new Error("Expected all struct fields to be key-value pairs");
            }
            if (tail && tail.type !== "identifier") {
                throw new Error("Expected struct tail to be an identifier");
            }
            const pairs = (fields as CST.Types.KeyValueNode[]).map<[string, CST.Types.SyntaxNode]>(kv => {
                const { key, value } = CST.Utils.extractFields(kv, "key", "value");
                return [key.text, value];
            });

            return yield* commonStructInference(pairs, tail as CST.Types.IdentifierNode | undefined);
        }),
    );

export const commonStructInference = function* (pairs: Array<[string, CST.Types.SyntaxNode]>, tail?: CST.Types.IdentifierNode): M.Gelaboration<tmp.Typing> {
    const ctx = yield* M.ask();
    const run = withSigmaCtx(pairs, tail as CST.Types.IdentifierNode | undefined);
    const result = yield* run(() => collect(pairs, tail as CST.Types.IdentifierNode | undefined))


    const mkRows = (start: [EB.Row, NF.Row]) =>
        result.fields.reduceRight<[EB.Row, NF.Row]>(
            ([rtm, rty], { label, term, value }) => [R.Constructors.Extension(label, term, rtm), R.Constructors.Extension(label, value, rty)],
            start,
        );

    const tvar = result.tail;
    if (!tvar) {
        const [rtm, rty] = mkRows([R.Constructors.Empty(), R.Constructors.Empty()]);
        // No tail, simple struct and respective schema type
        return [EB.Constructors.Struct(rtm), NF.Constructors.Schema(rty)] satisfies tmp.Typing;
    }


    const [tm, ty] = yield* match(NF.unwrapNeutral(tvar.ty))
        .with({ type: "Lit", value: { type: "Atom", value: "Row" } }, function* () {
            // If tail is a var of type Row, then our term is a schema, which is of type Type. We can safely ignore the per-label inferred values (types)
            const rtm = result.fields.reduceRight<EB.Row>((r, { label, term }) => R.Constructors.Extension(label, term, r), R.Constructors.Variable(tvar.variable));
            return [EB.Constructors.Schema(rtm), NF.Type] as const;
        })
        .with(NF.Patterns.Schema, function* (s) {
            // If tail is a schema itself, then our term is a "struct merger", meaning the type is a Schema composed of the fields + the tail schema's fields
            const [rtm, rty] = mkRows([R.Constructors.Variable(tvar.variable), s.arg.row]);
            return [EB.Constructors.Struct(rtm), NF.Constructors.Schema(rty)] as const;
        })
        .with(NF.Patterns.Flex, function* (meta) {
            // If tail is a meta variable, we cannot be sure if it's a struct or a schema.
            // We default to struct, and emit a constraint equating the meta to a schema over a fresh meta of type Row.
            // This fresh meta will end up generalized, therefore quantifying this term over some polymorphic row type.
            // Therefore the type is the inferred row + the fresh meta of type Row
            const freshRowMeta = yield* EB.freshMeta(ctx.env.length, NF.Row);
            const schemaTy = NF.Constructors.Schema(R.Constructors.Variable(freshRowMeta));
            yield* M.tell("constraint", { type: "assign", left: meta, right: schemaTy });

            const [rtm, rty] = mkRows([R.Constructors.Variable(tvar.variable), R.Constructors.Variable(freshRowMeta)]);
            return [EB.Constructors.Struct(rtm), NF.Constructors.Schema(rty)] as const;
        })
        .otherwise(() => {
            throw new Error("Elaborating Struct: Tail type is neither Schema, Row nor Flex");
        });

    return [tm, ty] satisfies tmp.Typing;
}



