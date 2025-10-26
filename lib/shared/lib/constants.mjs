import "../../chunk-ZD7AOCMD.mjs";
import * as Lib from "@yap/shared/lib/primitives";
import * as Sub from "@yap/elaboration/unification/substitution";
const defaultContext = {
  env: [],
  implicits: [],
  sigma: {},
  trace: [],
  imports: { ...Lib.Elaborated() },
  zonker: Sub.empty,
  ffi: Lib.PrimOps,
  metas: {}
};
export {
  defaultContext
};
//# sourceMappingURL=constants.mjs.map