import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import { Liquid } from "@yap/verification/modalities";

type Modal = Extract<Src.Term, { type: "modal" }>;
export const infer = (modal: Modal): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: modal, metadata: { action: "infer", description: "Modal term" } }, function* () {
		const [tm, _ty, us] = yield* EB.infer(modal.term);

		const nf = yield* NF.normalize(tm); // Modalities work on the term (in normal form), not on its type
		const liquid = modal.modalities.liquid ? yield* EB.Liquid.typecheck(modal.modalities.liquid, nf) : Liquid.Predicate.Neutral(tm);
		const quantity = modal.modalities.quantity ?? Q.Many;

		return [EB.Constructors.Modal(tm, { quantity, liquid }), nf, us] satisfies EB.AST;
	});
