
import * as CST from "@yap/cst"
import * as M from "@yap/monad"
import * as EB from "@yap/elaboration"
import * as NF from "@yap/elaboration/normalization";
import { R } from "vitest/dist/chunks/config.d.g6OOauRt";
import * as tmp from "./tmp";
import { entries, setProp } from "@yap/utils";

type Result = {
    fields: Array<{ label: string; term: EB.Term; value: NF.Value }>;
    tail?: {
        variable: EB.Variable;
        ty: NF.Value;
    };
}

export const withSigmaCtx = (pairs: Array<[string, CST.Types.SyntaxNode]>, tail?: CST.Types.IdentifierNode) => function*<A>(action: () => M.Gelaboration<A>): M.Gelaboration<A> {
    const bindings = yield* extract(pairs, tail);
    return yield* M.local(ctx => entries(bindings).reduce((ctx, [label, sig]) => EB.extendSigma(ctx, label, sig), ctx), M.Do(action));
    
}


const extract = function* (pairs: Array<[string, CST.Types.SyntaxNode]>, tail?: CST.Types.IdentifierNode): M.Gelaboration<Record<string, EB.Sigma>> {

    if (tail) return {}
    if (pairs.length === 0) return {}

    const ctx = yield* M.ask();
    const lvl = ctx.env.length;

    const ktm = NF.Constructors.Flex(yield* EB.freshMeta(lvl, NF.Type));
    const tm = NF.Constructors.Flex(yield* EB.freshMeta(lvl, ktm));
    const ty = NF.Constructors.Flex(yield* EB.freshMeta(lvl, NF.Type));

    const [[lbl], ...ps] = pairs;

    const sigma: EB.Sigma = { term: NF.quote(ctx, ctx.env.length, tm), nf: tm, ann: ty };

    const result = yield* extract(ps, tail);
    return setProp(result, lbl, sigma);
};

