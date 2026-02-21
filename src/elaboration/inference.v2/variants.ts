import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";

type Variant = Extract<CST.Types.SyntaxNode, { type: "variant" }>;

export const infer = (node: Variant): M.Elaboration<tmp.Typing> =>
    M.track(
        { tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Variant type" } },
        M.Do(function* () {
            // Variants are types, so we check them against Type
            const tm = yield* tmp.check(node, NF.Type);
            return [tm, NF.Type] satisfies tmp.Typing;
        }),
    );
