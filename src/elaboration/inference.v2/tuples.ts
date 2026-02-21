import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";

import * as tmp from "./tmp";
import * as F from "fp-ts/lib/function";
import { commonStructInference } from "./structs";



export const infer = (node: CST.Types.TupleNode): M.Elaboration<tmp.Typing> =>
    M.track(
        { tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Tuple" } },
        M.Do(function* () {

            const { element: elements, tail } = CST.Utils.extractFields(node, ["element"], "tail", );

            if (tail && tail.type !== "identifier") {
                throw new Error("Expected struct tail to be an identifier");
            }
            const pairs = (elements).map<[string, CST.Types.SyntaxNode]>((e, i) => [i.toString(), e]);

            return yield* commonStructInference(pairs, tail as CST.Types.IdentifierNode | undefined);
        }),
    );
