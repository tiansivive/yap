import { match } from "ts-pattern";

import * as M from "@yap/monad";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/normalization";
import * as CST from "@yap/cst";

import * as Modal from "./modal";

import { SyntaxType } from "@yap/cst/types/generated";

export * as Patterns from "./patterns";

export type Typing = [EB.Term, NF.Value];
export type StmtTyping = [EB.Statement, NF.Value];

export function* check(node: CST.Types.SyntaxNode, type: NF.Value): Generator<M.Elaboration<EB.Term>, EB.Term, EB.Term> {
	return 1 as any;
}

export function* infer(node: CST.Types.SyntaxNode): Generator<M.Elaboration<NF.Value>, Typing, Typing> {
	const elaboration = match(node.type)
		.with(SyntaxType.Modal, () => Modal.infer(node))
		.otherwise(() =>
			M.Do(function* () {
				return 1 as any;
			}),
		);
	return yield* elaboration;
}

export const Stmt = {
	infer: function* (node: CST.Types.SyntaxNode): Generator<M.Elaboration<StmtTyping>, StmtTyping, StmtTyping> {
		return 1 as any;
	},
};
