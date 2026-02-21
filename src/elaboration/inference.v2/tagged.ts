import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";
import * as R from "@yap/shared/rows";
import * as F from "fp-ts/function";

type Tagged = Extract<CST.Types.SyntaxNode, { type: "tagged" }>;

export const infer = (node: Tagged): M.Elaboration<tmp.Typing> =>
    M.track(
        { tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Tagged value" } },
        M.Do(function* () {
            const { tag, payload } = CST.Utils.extractFields(node, "tag", "payload");

            const [tm, ty] = yield* tmp.infer(payload);
            const ctx = yield* M.ask();

            const rvar: NF.Row = R.Constructors.Variable(yield* EB.freshMeta(ctx.env.length, NF.Row));
            const row: NF.Row = NF.Constructors.Extension(tag.text, ty, rvar);
            const variant = NF.Constructors.Variant(row);

            const trow = EB.Constructors.Extension(tag.text, tm, { type: "empty" });
            const tagtm = EB.Constructors.Struct(trow);

            return [tagtm, variant] satisfies tmp.Typing;
        }),
    );
