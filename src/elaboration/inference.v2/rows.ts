import * as CST from "@yap/cst"
import * as M from "@yap/monad"
import * as EB from "@yap/elaboration"
import * as NF from "@yap/elaboration/normalization";

import * as tmp from "./tmp";

type Result = {
    fields: Array<{ label: string; term: EB.Term; value: NF.Value }>;
    tail?: {
        variable: EB.Variable;
        ty: NF.Value;
    };
}

export const collect = function* (pairs: Array<[string, CST.Types.SyntaxNode]>, tail?: CST.Types.IdentifierNode): M.Gelaboration<Result> {
    const ctx = yield* M.ask();

    const collected: Result["fields"] = yield M.traverse(pairs, function* ([label, node]) {

        const [vtm, vty] = yield* tmp.infer(node);
        const sigma = ctx.sigma[label];
        if (!sigma) {
            throw new Error("Elaborating Struct Field: Label not found");
        }

        yield* M.tell("constraint", [
            { type: "assign", left: vty, right: sigma.nf },
        ]);

        return { label, term: vtm, value: vty }
    })

    if (!tail) { return { fields: collected } }

    const [tm, ty] = yield* EB.lookup.gen({ type: "name", value: tail.text }, ctx);
    if (tm.type !== "Var") {
        throw new Error("Elaborating Struct Tail: Not a variable");
    }

    return {
        fields: collected,
        tail: { variable: tm.variable, ty }
    }

}