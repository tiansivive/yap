import * as M from "@yap/monad";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/normalization";
import * as CST from "@yap/cst";

export * as Patterns from "./patterns";

export type Typing = [EB.Term, NF.Value];
export type StmtTyping = [EB.Statement, NF.Value];

export function* check(node: CST.Types.SyntaxNode, type: NF.Value): Generator<M.Elaboration<EB.Term>, EB.Term, EB.Term> {
	return 1;
}

export function* infer(node: CST.Types.SyntaxNode): Generator<M.Elaboration<NF.Value>, Typing, Typing> {
	return 1;
}

export const Stmt = {
	infer: (node: CST.Types.SyntaxNode): Generator<M.Elaboration<StmtTyping>, StmtTyping, StmtTyping> => {
		return 1;
	},
};

