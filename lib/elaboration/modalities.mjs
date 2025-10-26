import "../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import { Liquid as L } from "@yap/verification/modalities";
const Liquid = {
  typecheck: function* (refinement, ty) {
    const ctx = yield* V2.ask();
    const [tm] = yield* EB.Check.val.gen(refinement, L.Predicate.Kind(ctx, ty));
    return tm;
  }
};
export {
  Liquid
};
//# sourceMappingURL=modalities.mjs.map