import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as F from "fp-ts/lib/function";
const infer = (h) => V2.track(
  { tag: "src", type: "term", term: h, metadata: { action: "infer", description: "Hole" } },
  V2.Do(function* () {
    const ctx = yield* V2.ask();
    const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
    const meta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
    const ty = NF.evaluate(ctx, meta);
    return [meta, ty, Q.noUsage(ctx.env.length)];
  })
);
infer.gen = F.flow(infer, V2.pure);
export {
  infer
};
//# sourceMappingURL=holes.mjs.map