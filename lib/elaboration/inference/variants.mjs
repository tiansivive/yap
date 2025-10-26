import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
const infer = (variant) => V2.track(
  { tag: "src", type: "term", term: variant, metadata: { action: "infer", description: "Variant" } },
  V2.Do(
    () => V2.local(
      EB.muContext,
      V2.Do(function* () {
        const [tm, us] = yield* EB.check.gen(variant, NF.Type);
        return [tm, NF.Type, us];
      })
    )
  )
);
export {
  infer
};
//# sourceMappingURL=variants.mjs.map