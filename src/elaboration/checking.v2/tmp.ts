import * as M from "@yap/monad";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/normalization";
import * as CST from "@yap/cst";

export function* check(node: CST.Types.SyntaxNode, type: NF.Value): Generator<M.Elaboration<EB.Term>, EB.Term, EB.Term> {
    return 1 as any;
}

export function* infer(node: CST.Types.SyntaxNode): Generator<M.Elaboration<[EB.Term, NF.Value]>, [EB.Term, NF.Value], [EB.Term, NF.Value]> {
    return 1 as any;
}
