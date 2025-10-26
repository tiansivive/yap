import "../../chunk-ZD7AOCMD.mjs";
import * as F from "fp-ts/function";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
const infer = (tagged) => V2.track(
  { tag: "src", type: "term", term: tagged, metadata: { action: "infer", description: "Tagged" } },
  V2.Do(function* () {
    const { tag, term } = tagged;
    const [tm, ty, us] = yield* EB.infer.gen(term);
    const ctx = yield* V2.ask();
    const rvar = R.Constructors.Variable(yield* EB.freshMeta(ctx.env.length, NF.Row));
    const row = NF.Constructors.Extension(tag, ty, rvar);
    const variant = NF.Constructors.Variant(row);
    const trow = EB.Constructors.Extension(tag, tm, { type: "empty" });
    const tagtm = EB.Constructors.Struct(trow);
    return [tagtm, variant, us];
  })
);
infer.gen = F.flow(infer, V2.pure);
export {
  infer
};
//# sourceMappingURL=tagged.mjs.map