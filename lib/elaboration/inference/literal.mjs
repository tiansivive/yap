import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as F from "fp-ts/lib/function";
import { match } from "ts-pattern";
import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";
import { NF } from "@yap/elaboration";
const infer = (lit) => V2.track(
  { tag: "src", type: "term", term: lit, metadata: { action: "infer", description: "Literal" } },
  V2.Do(function* () {
    const { value } = lit;
    const ctx = yield* V2.ask();
    const atom = match(value).with({ type: "String" }, (_) => Lit.Atom("String")).with({ type: "Num" }, (_) => Lit.Atom("Num")).with({ type: "Bool" }, (_) => Lit.Atom("Bool")).with({ type: "unit" }, (_) => Lit.Atom("Unit")).with({ type: "Atom" }, (_) => Lit.Atom("Type")).exhaustive();
    return [EB.Constructors.Lit(value), NF.Constructors.Lit(atom), Q.noUsage(ctx.env.length)];
  })
);
infer.gen = F.flow(infer, V2.pure);
export {
  infer
};
//# sourceMappingURL=literal.mjs.map