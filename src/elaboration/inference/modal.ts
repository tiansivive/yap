import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import { Liquid } from "@yap/verification/modalities";

type Modal = Extract<Src.Term, { type: "modal" }>;
export const infer = (modal: Modal): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: modal, metadata: { action: "infer", description: "Modal term" } },
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const [tm, ty, us] = yield* EB.infer.gen(modal.term);

			const nf = NF.evaluate(ctx, tm); // Modalities work on the term (in normal form), not on its type
			const liquid = modal.modalities.liquid ? yield* EB.Liquid.typecheck(modal.modalities.liquid, nf) : Liquid.Predicate.Neutral();
			const quantity = modal.modalities.quantity ?? Q.Many;

			return [EB.Constructors.Modal(tm, { quantity, liquid: NF.evaluate(ctx, liquid) }), nf, us] satisfies EB.AST;
		}),
	);

infer.gen = F.flow(infer, V2.pure);
