import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";
import { Liquid } from "@yap/verification/modalities";

import * as tmp from "./tmp";

type ModalNode = Extract<CST.Types.SyntaxNode, { type: "modal" }>;

export const infer = (node: ModalNode): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Modal term" } },
		M.Do(function* () {
			const ctx = yield* M.ask();
			const { term, quantity, liquid } = CST.Utils.extractModal(node);

			const [tm, nf] = yield* tmp.infer(term);

			const liquidTm = liquid ? yield* tmp.check(liquid, Liquid.Predicate.Kind(ctx, nf)) : Liquid.Predicate.Neutral(tm);

			return [EB.Constructors.Modal(tm, { quantity, liquid: liquidTm }), nf] satisfies tmp.Typing;
		}),
	);
