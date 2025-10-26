import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";
import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as F from "fp-ts/function";
const infer = (injection) => V2.track(
  { tag: "src", type: "term", term: injection, metadata: { action: "infer", description: "Injection" } },
  V2.Do(function* () {
    const { label, value, term } = injection;
    const val = yield* EB.infer.gen(value);
    const tm = yield* EB.infer.gen(term);
    const injected = yield* inject.gen(label, val, tm);
    return [EB.Constructors.Inj(label, val[0], tm[0]), injected, Q.add(tm[2], val[2])];
  })
);
infer.gen = F.flow(infer, V2.pure);
const inject = (label, value, tm) => V2.Do(function* () {
  const ctx = yield* V2.ask();
  const val = yield* V2.pure(
    match(tm[1]).with({ type: "Neutral" }, ({ value: v }) => inject(label, value, [tm[0], v, tm[2]])).with(
      { type: "Var" },
      (_) => V2.Do(function* () {
        const r = { type: "variable", variable: yield* EB.freshMeta(ctx.env.length, NF.Row) };
        const rowTypeCtor = EB.Constructors.Pi("rx", "Explicit", EB.Constructors.Lit(Lit.Row()), EB.Constructors.Lit(Lit.Type()));
        const ann = NF.evaluate(ctx, rowTypeCtor);
        const ctor = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, ann)));
        const inferred = NF.Constructors.App(ctor, NF.Constructors.Row(r), "Explicit");
        const extended = NF.Constructors.App(ctor, NF.Constructors.Row(NF.Constructors.Extension(label, value[1], r)), "Explicit");
        yield* V2.tell("constraint", { type: "assign", left: inferred, right: tm[1], lvl: ctx.env.length });
        return extended;
      })
    ).with(
      { type: "App", func: { type: "Lit", value: { type: "Atom" } }, arg: { type: "Row" } },
      ({
        func: {
          value: { value: value2 }
        }
      }) => value2 === "Schema" || value2 === "Variant",
      ({ func, arg }) => {
        const extended = NF.Constructors.App(func, NF.Constructors.Row(NF.Constructors.Extension(label, value[1], arg.row)), "Explicit");
        return V2.of(extended);
      }
    ).otherwise((_) => {
      throw new Error("Injection: Expected Row type");
    })
  );
  return val;
});
inject.gen = F.flow(inject, V2.pure);
export {
  infer
};
//# sourceMappingURL=injection.mjs.map