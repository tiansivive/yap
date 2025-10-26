import "../../chunk-ZD7AOCMD.mjs";
import * as F from "fp-ts/lib/function";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as NF from "@yap/elaboration/normalization";
const infer = (lam) => V2.track(
  { tag: "src", type: "term", term: lam, metadata: { action: "infer", description: "Lambda" } },
  V2.Do(function* () {
    const ctx = yield* V2.ask();
    const [ann, us] = lam.annotation ? yield* EB.check.gen(lam.annotation, NF.Type) : [EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type)), Q.noUsage(ctx.env.length)];
    const ty = NF.evaluate(ctx, ann);
    const ast = yield* V2.local(
      (_ctx) => EB.bind(_ctx, { type: "Lambda", variable: lam.variable }, ty),
      V2.Do(function* () {
        const inferred = yield* EB.infer.gen(lam.body);
        const [bTerm, bType, [vu, ...bus]] = yield* EB.Icit.insert.gen(inferred);
        const tm = EB.Constructors.Lambda(lam.variable, lam.icit, bTerm, ann);
        const pi = NF.Constructors.Pi(lam.variable, lam.icit, ty, NF.closeVal(ctx, bType));
        return [tm, pi, bus];
      })
    );
    return ast;
  })
);
infer.gen = F.flow(infer, V2.pure);
export {
  infer
};
//# sourceMappingURL=lambda.mjs.map