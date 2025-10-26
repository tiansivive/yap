import "../../chunk-ZD7AOCMD.mjs";
import * as F from "fp-ts/lib/function";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as NF from "@yap/elaboration/normalization";
import { Liquid } from "@yap/verification/modalities";
const infer = (modal) => V2.track(
  { tag: "src", type: "term", term: modal, metadata: { action: "infer", description: "Modal term" } },
  V2.Do(function* () {
    const ctx = yield* V2.ask();
    const [tm, ty, us] = yield* EB.infer.gen(modal.term);
    const nf = NF.evaluate(ctx, tm);
    const liquid = modal.modalities.liquid ? yield* EB.Liquid.typecheck(modal.modalities.liquid, nf) : Liquid.Predicate.Neutral(tm);
    const quantity = modal.modalities.quantity ?? Q.Many;
    return [EB.Constructors.Modal(tm, { quantity, liquid }), nf, us];
  })
);
infer.gen = F.flow(infer, V2.pure);
export {
  infer
};
//# sourceMappingURL=modal.mjs.map