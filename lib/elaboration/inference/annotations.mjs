import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
const infer = (node) => V2.track(
  { tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Annotation node" } },
  V2.Do(function* () {
    const { term, ann } = node;
    const ctx = yield* V2.ask();
    const ast = yield* EB.check.gen(ann, NF.Type);
    const nf = NF.evaluate(ctx, ast[0]);
    const [_term, us] = yield* EB.check.gen(term, nf);
    return [_term, nf, us];
  })
);
export {
  infer
};
//# sourceMappingURL=annotations.mjs.map