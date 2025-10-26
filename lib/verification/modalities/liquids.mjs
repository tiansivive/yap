import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
const tru = () => NF.Constructors.Lit({ type: "Bool", value: true });
const fls = () => NF.Constructors.Lit({ type: "Bool", value: false });
const Constants = { tru, fls };
let count = 0;
const fresh = () => {
  ++count;
  return `$r${count}`;
};
const Predicate = {
  Kind: (ctx, arg) => NF.Constructors.Pi(fresh(), "Explicit", arg, NF.closeVal(ctx, NF.Constructors.Lit(Lit.Atom("Bool")))),
  Neutral: (ann) => {
    return EB.Constructors.Lambda(fresh(), "Explicit", EB.Constructors.Lit({ type: "Bool", value: true }), ann);
  },
  NeutralNF: (ann, ctx) => {
    const closure = NF.Constructors.Closure(ctx, EB.Constructors.Lit(Lit.Bool(true)));
    return NF.Constructors.Lambda(fresh(), "Explicit", closure, ann);
  },
  True: (Z3) => Z3.Bool.val(true)
};
export {
  Constants,
  Predicate
};
//# sourceMappingURL=liquids.mjs.map