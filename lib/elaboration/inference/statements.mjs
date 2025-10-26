import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as F from "fp-ts/lib/function";
import { match } from "ts-pattern";
import { freshMeta } from "@yap/elaboration/shared/supply";
const infer = (stmt) => V2.track(
  { tag: "src", type: "stmt", stmt, metadata: { action: "infer", description: "Statement" } },
  (() => match(stmt).with(
    { type: "let" },
    (letdec) => V2.Do(function* () {
      const ctx = yield* V2.ask();
      const ann = letdec.annotation ? yield* EB.check.gen(letdec.annotation, NF.Type) : [EB.Constructors.Var(yield* freshMeta(ctx.env.length, NF.Type)), Q.noUsage(ctx.env.length)];
      const va = NF.evaluate(ctx, ann[0]);
      const inferred = yield* V2.local(
        (_ctx) => EB.bind(_ctx, { type: "Let", variable: letdec.variable }, va),
        V2.Do(function* () {
          const inferred2 = yield* EB.check.gen(letdec.value, va);
          const [bTerm, [vu, ...bus]] = inferred2;
          return [bTerm, va, bus];
        })
      );
      const { binders } = yield* V2.listen();
      const tm = binders.find((b) => b.type === "Mu" && b.variable === letdec.variable) ? EB.Constructors.Mu("x", letdec.variable, ann[0], inferred[0]) : inferred[0];
      const def = EB.Constructors.Stmt.Let(letdec.variable, tm, va);
      return [def, inferred[1], inferred[2]];
    })
  ).with(
    { type: "expression" },
    ({ value }) => V2.Do(function* () {
      const [expr, ty, us] = yield* EB.infer.gen(value);
      return [EB.Constructors.Stmt.Expr(expr), ty, us];
    })
  ).with(
    { type: "using" },
    ({ value }) => V2.Do(function* () {
      const [tm, ty, us] = yield* EB.infer.gen(value);
      return [{ type: "Using", value: tm, annotation: ty }, ty, us];
    })
  ).otherwise(() => {
    throw new Error("Not implemented yet");
  }))()
);
infer.gen = F.flow(infer, V2.pure);
export {
  infer
};
//# sourceMappingURL=statements.mjs.map