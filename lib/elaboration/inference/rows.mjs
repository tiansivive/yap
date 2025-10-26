import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as F from "fp-ts/function";
import * as R from "@yap/shared/rows";
import { entries, setProp } from "@yap/utils";
const infer = (term) => V2.track(
  { tag: "src", type: "term", term, metadata: { action: "infer", description: "Row" } },
  V2.Do(
    () => V2.local(
      EB.muContext,
      V2.Do(function* () {
        const { fields, tail } = yield* inSigmaContext.gen(term.row, collect(term.row));
        if (tail) {
          throw new Error("Row literals with tails are not supported");
        }
        const tm = fields.reduce((r, { label, term: term2 }) => R.Constructors.Extension(label, term2, r), R.Constructors.Empty());
        return [EB.Constructors.Row(tm), NF.Row, Q.noUsage(0)];
      })
    )
  )
);
infer.gen = F.flow(infer, V2.pure);
const inSigmaContext = (row, f) => V2.Do(function* () {
  const ctx = yield* V2.ask();
  const bindings = yield* extract(row, ctx.env.length);
  return yield* V2.local((ctx_) => entries(bindings).reduce((ctx2, [label, mv]) => EB.extendSigma(ctx2, label, mv), ctx_), f);
});
inSigmaContext.gen = (row, f) => V2.pure(inSigmaContext(row, f));
const collect = (row) => V2.Do(function* () {
  const ctx = yield* V2.ask();
  const initial = { fields: [] };
  const collected = yield R.fold(
    row,
    (val, lbl, acc) => V2.Do(function* () {
      const [vtm, vty, qs] = yield* EB.infer.gen(val);
      const sigma = ctx.sigma[lbl];
      if (!sigma) {
        throw new Error("Elaborating Row Extension: Label not found");
      }
      const nf = NF.evaluate(ctx, vtm);
      yield* V2.tell("constraint", [
        { type: "assign", left: nf, right: sigma.nf },
        { type: "assign", left: vty, right: sigma.ann }
      ]);
      const accumulated = yield acc;
      return { fields: [...accumulated.fields, { label: lbl, term: vtm, value: vty }], tail: accumulated.tail };
    }),
    (v, acc) => V2.Do(function* () {
      const [tm, ty, qs] = yield* EB.lookup.gen(v, ctx);
      if (tm.type !== "Var") {
        throw new Error("Elaborating Row Var: Not a variable");
      }
      const _ty = NF.unwrapNeutral(ty);
      const accumulated = yield acc;
      return { fields: accumulated.fields, tail: { variable: tm.variable, ty: _ty } };
    }),
    V2.of(initial)
  );
  return collected;
});
collect.gen = F.flow(collect, V2.pure);
const extract = function* (row, lvl, types) {
  if (row.type === "empty") {
    return {};
  }
  if (row.type === "variable") {
    return {};
  }
  const ktm = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
  const tm = NF.Constructors.Var(yield* EB.freshMeta(lvl, ktm));
  const kty = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
  const ty = NF.Constructors.Var(yield* EB.freshMeta(lvl, kty));
  const info = { nf: tm, ann: ty, multiplicity: Q.Many };
  const rest = yield* extract({ ...row.row, location: row.location }, lvl + 1);
  return setProp(rest, row.label, info);
};
export {
  collect,
  extract,
  inSigmaContext,
  infer
};
//# sourceMappingURL=rows.mjs.map