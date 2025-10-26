import {
  __commonJS
} from "../../chunk-ZD7AOCMD.mjs";
import * as NF from "@yap/elaboration/normalization";
var require_zonking = __commonJS({
  "src/elaboration/unification/zonking.ts"() {
    const zonkNF = (nf, ctx) => {
      NF.traverse(
        nf,
        (v) => {
          if (v.variable.type !== "Meta") {
            return v;
          }
          if (!ctx.zonker[v.variable.val]) {
            return v;
          }
          return zonkNF(ctx.zonker[v.variable.val], ctx);
        },
        (tm) => zonkTM(tm, ctx)
      );
      return 1;
    };
    const zonkTM = (tm, ctx) => {
      return 1;
    };
  }
});
export default require_zonking();
//# sourceMappingURL=zonking.mjs.map