import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
const Verification = {
  implication: (p, q) => NF.DSL.Binop.or(NF.DSL.Unop.not(p), q),
  imply: (ctx, ann, p, q) => {
    const x = EB.Constructors.Var({ type: "Bound", index: 0 });
    const tm = EB.Constructors.App("Explicit", p, x);
    const extended = EB.bind(ctx, { type: "Lambda", variable: "$x" }, ann, "inserted");
    const c = NF.quote(extended, extended.env.length, q);
    const and = EB.DSL.and(tm, c);
    return NF.Constructors.Lambda("$x", "Explicit", NF.Constructors.Closure(ctx, and), ann);
  }
};
export {
  Verification
};
//# sourceMappingURL=shared.mjs.map