import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";
import { Liquid } from "@yap/verification/modalities";

import * as tmp from "./tmp";

type ModalNode = Extract<CST.Types.SyntaxNode, { type: "modal" }>;

export const check = (node: ModalNode, type: NF.Value): M.Elaboration<EB.Term> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const { term, quantity, liquid } = CST.Utils.extractModal(node);

		const checked = yield* tmp.check(term, type);
		const nf = NF.evaluate(ctx, checked);

		const liquidTm = liquid ? yield* tmp.check(liquid, Liquid.Predicate.Kind(ctx, nf)) : Liquid.Predicate.Neutral(checked);

		return EB.Constructors.Modal(checked, { quantity, liquid: liquidTm });
	});
