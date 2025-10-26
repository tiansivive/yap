import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as F from "fp-ts/lib/function";
const infer = (tuple) => V2.track({ tag: "src", type: "term", term: tuple, metadata: { action: "infer", description: "Tuple" } }, EB.Struct.commonStructInference(tuple.row));
infer.gen = F.flow(infer, V2.pure);
export {
  infer
};
//# sourceMappingURL=tuples.mjs.map