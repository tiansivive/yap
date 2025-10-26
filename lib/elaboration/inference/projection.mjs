import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";
import * as Lit from "@yap/shared/literals";
import * as F from "fp-ts/function";
const infer = V2.regen(
  ({ label, term }) => V2.track(
    { tag: "src", type: "term", term, metadata: { action: "infer", description: "Projection of label: " + label } },
    V2.Do(function* () {
      const [tm, ty, us] = yield* EB.infer.gen(term);
      const inferred = yield* project.gen(label, tm, ty, us);
      return [EB.Constructors.Proj(label, tm), inferred, us];
    })
  )
);
const project = (label, tm, ty, us) => V2.Do(function* () {
  const ctx = yield* V2.ask();
  const nf = match(ty).with({ type: "Neutral" }, ({ value }) => project(label, tm, value, us)).with(
    { type: "Var" },
    (_) => V2.Do(function* () {
      const rowTypeCtor = EB.Constructors.Pi("rx", "Explicit", EB.Constructors.Lit(Lit.Row()), EB.Constructors.Lit(Lit.Type()));
      const ann = NF.evaluate(ctx, rowTypeCtor);
      const ctor = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, ann)));
      const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
      const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));
      const r = { type: "variable", variable: yield* EB.freshMeta(ctx.env.length, NF.Row) };
      const xtension = NF.Constructors.Extension(label, val, r);
      const inferred = NF.Constructors.App(ctor, NF.Constructors.Row(xtension), "Explicit");
      yield* V2.tell("constraint", { type: "assign", left: inferred, right: ty });
      return inferred;
    })
  ).with(
    NF.Patterns.Schema,
    ({ func, arg }) => V2.Do(function* () {
      const from = (l, row) => {
        return match(row).with({ type: "empty" }, (_) => {
          return V2.Do(() => V2.fail({ type: "MissingLabel", label: l, row }));
        }).with(
          { type: "extension" },
          ({ label: l_ }) => l === l_,
          ({ label: label2, value, row: row2 }) => V2.of([NF.Constructors.Extension(label2, value, row2), value])
        ).with(
          { type: "extension" },
          (r2) => V2.Do(function* () {
            const [rr, vv] = yield from(l, r2.row);
            return [NF.Constructors.Extension(r2.label, r2.value, rr), vv];
          })
        ).with(
          { type: "variable" },
          (r2) => V2.Do(function* () {
            const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
            const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));
            return [NF.Constructors.Extension(l, val, r2), val];
          })
        ).exhaustive();
      };
      const [r, v] = yield from(label, arg.row);
      const inferred = NF.Constructors.App(func, NF.Constructors.Row(r), "Explicit");
      yield* V2.tell("constraint", { type: "assign", left: inferred, right: ty });
      return v;
    })
  ).otherwise((_) => {
    throw new Error("Expected Row Type");
  });
  return yield* V2.pure(nf);
});
project.gen = F.flow(project, V2.pure);
export {
  infer,
  project
};
//# sourceMappingURL=projection.mjs.map