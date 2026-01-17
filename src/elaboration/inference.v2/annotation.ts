import * as CST from "@yap/src/index";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import { check, Typing } from "./tmp";

type Annotation = Extract<CST.Types.SyntaxNode, { type: "annotation" }>;

export const infer = (node: Annotation): M.Elaboration<Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Annotation node" } },
		M.Do(function* () {
			const { expr, type } = CST.Utils.extractFields(node, "expr", "type");
			const ctx = yield* M.ask();

			// FIXME:TODO: This was a fix for allowing singleton numbers as annotations. The correct was is to pattern match on check(Lit.Num, Type), and allow that check to succeed
			const ast = yield* check(type, NF.Type);
			const nf = NF.evaluate(ctx, ast);

			const term = yield* check(expr, nf);
			return [term, nf] satisfies Typing;
		}),
	);
