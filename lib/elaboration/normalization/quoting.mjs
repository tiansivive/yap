import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as NF from ".";
import { match } from "ts-pattern";
const quote = (ctx, lvl, val) => {
  return match(val).with({ type: "Lit" }, ({ value }) => EB.Constructors.Lit(value)).with(
    { type: "Var" },
    ({ variable }) => match(variable).with({ type: "Bound" }, (v) => {
      return EB.Constructors.Var({ type: "Bound", index: lvl - v.lvl - 1 });
    }).otherwise((v) => EB.Constructors.Var(v))
  ).with({ type: "Neutral" }, ({ value }) => quote(ctx, lvl, value)).with({ type: "App" }, ({ func, arg, icit }) => EB.Constructors.App(icit, quote(ctx, lvl, func), quote(ctx, lvl, arg))).with({ type: "Abs", binder: { type: "Lambda" } }, ({ binder, closure }) => {
    const { variable, icit, annotation } = binder;
    const val2 = NF.apply(binder, closure, NF.Constructors.Rigid(lvl));
    const body = quote(ctx, lvl + 1, val2);
    const ann = NF.quote(ctx, lvl, annotation);
    return EB.Constructors.Lambda(variable, icit, body, ann);
  }).with({ type: "Abs", binder: { type: "Pi" } }, ({ binder, closure }) => {
    const { variable, icit, annotation } = binder;
    const val2 = NF.apply(binder, closure, NF.Constructors.Rigid(lvl));
    const body = quote(ctx, lvl + 1, val2);
    const ann = NF.quote(ctx, lvl, annotation);
    return EB.Constructors.Pi(variable, icit, ann, body);
  }).with({ type: "Abs", binder: { type: "Mu" } }, ({ binder, closure }) => {
    const { variable, source, annotation } = binder;
    const val2 = NF.apply(binder, closure, NF.Constructors.Rigid(lvl));
    const body = quote(ctx, lvl + 1, val2);
    const ann = NF.quote(ctx, lvl, annotation);
    return EB.Constructors.Mu(variable, source, ann, body);
  }).with({ type: "Row" }, ({ row }) => {
    const _quote = (r) => match(r).with({ type: "empty" }, () => ({ type: "empty" })).with({ type: "extension" }, ({ label, value, row: row2 }) => EB.Constructors.Extension(label, quote(ctx, lvl, value), _quote(row2))).with({ type: "variable" }, ({ variable }) => {
      const v = match(variable).with({ type: "Bound" }, (v2) => ({ type: "Bound", index: lvl - v2.lvl - 1 })).otherwise((v2) => v2);
      return { type: "variable", variable: v };
    }).exhaustive();
    return EB.Constructors.Row(_quote(row));
  }).with({ type: "External" }, ({ name, arity, compute, args }) => {
    return args.reduce((acc, arg) => EB.Constructors.App("Explicit", acc, quote(ctx, lvl, arg)), EB.Constructors.Var({ type: "Foreign", name }));
  }).with(
    { type: "Modal" },
    ({ value, modalities }) => EB.Constructors.Modal(quote(ctx, lvl, value), {
      quantity: modalities.quantity,
      liquid: quote(ctx, lvl, modalities.liquid)
    })
  ).otherwise((nf) => {
    throw new Error("Quote: Not implemented yet: " + NF.display(nf, ctx));
  });
};
const closeVal = (ctx, value) => ({
  type: "Closure",
  ctx,
  term: NF.quote(ctx, ctx.env.length + 1, value)
});
export {
  closeVal,
  quote
};
//# sourceMappingURL=quoting.mjs.map