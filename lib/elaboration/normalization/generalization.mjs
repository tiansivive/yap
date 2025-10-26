import "../../chunk-ZD7AOCMD.mjs";
import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";
import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";
import * as A from "fp-ts/Array";
import { set, update } from "@yap/utils";
import { collectMetasNF } from "../shared/metas";
const generalize = (val, ctx) => {
  const ms = collectMetasNF(val, ctx.zonker);
  if (ms.length === 0) {
    return [val, ctx];
  }
  const charCode = "a".charCodeAt(0);
  const extendedCtx = ms.reduce((acc, m, i) => {
    const name = `${String.fromCharCode(charCode + i)}`;
    const boundLvl = i;
    const { ann } = ctx.metas[m.val];
    const withBinder = EB.bind(acc, { type: "Pi", variable: name }, ann, "inserted");
    return set(withBinder, ["zonker", `${m.val}`], NF.Constructors.Var({ type: "Bound", lvl: boundLvl }));
  }, ctx);
  const generalized = A.reverse(ms).reduce((body, m, i) => {
    const idx = ms.length - 1 - i;
    const variable = String.fromCharCode(charCode + idx);
    const term = NF.quote(extendedCtx, ms.length - i, body);
    const { ann } = ctx.metas[m.val];
    return NF.Constructors.Pi(variable, "Implicit", ann, NF.Constructors.Closure(extendedCtx, term));
  }, val);
  return [generalized, extendedCtx];
};
const instantiate = (nf, ctx) => {
  return match(nf).with({ type: "Var" }, (v) => {
    if (v.variable.type !== "Meta") {
      return v;
    }
    if (!!ctx.zonker[v.variable.val]) {
      return v;
    }
    const { ann } = ctx.metas[v.variable.val];
    return match(ann).with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => NF.Constructors.Row({ type: "empty" })).with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => NF.Constructors.Lit({ type: "Atom", value: "Any" })).otherwise(() => NF.Constructors.Var(v.variable));
  }).with({ type: "Lit" }, (lit) => lit).with(NF.Patterns.Lambda, ({ binder, closure }) => {
    const ann = instantiate(binder.annotation, ctx);
    const xtended = EB.bind(closure.ctx, binder, ann);
    return NF.Constructors.Lambda(
      binder.variable,
      binder.icit,
      update(closure, "term", (t) => EB.Icit.instantiate(t, xtended)),
      ann
    );
  }).with(NF.Patterns.Pi, ({ binder, closure }) => {
    const ann = instantiate(binder.annotation, ctx);
    const xtended = EB.bind(closure.ctx, binder, ann);
    return NF.Constructors.Pi(
      binder.variable,
      binder.icit,
      ann,
      update(closure, "term", (t) => EB.Icit.instantiate(t, xtended))
    );
  }).with(NF.Patterns.Mu, ({ binder, closure }) => {
    const ann = instantiate(binder.annotation, ctx);
    const xtended = EB.bind(closure.ctx, binder, ann);
    return NF.Constructors.Mu(
      binder.variable,
      binder.source,
      ann,
      update(closure, "term", (t) => EB.Icit.instantiate(t, xtended))
    );
  }).with({ type: "App" }, ({ icit, func, arg }) => NF.Constructors.App(instantiate(func, ctx), instantiate(arg, ctx), icit)).with(
    { type: "Row" },
    ({ row }) => NF.Constructors.Row(
      R.traverse(
        row,
        (v) => instantiate(v, ctx),
        (v) => R.Constructors.Variable(v)
      )
    )
  ).with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(instantiate(value, ctx))).with(
    NF.Patterns.Modal,
    ({ value, modalities }) => NF.Constructors.Modal(instantiate(value, ctx), {
      quantity: modalities.quantity,
      liquid: instantiate(modalities.liquid, ctx)
    })
  ).otherwise(() => {
    throw new Error("Traverse: Not implemented yet");
  });
};
export {
  generalize,
  instantiate
};
//# sourceMappingURL=generalization.mjs.map