import "../../../chunk-ZD7AOCMD.mjs";
import { match } from "ts-pattern";
import * as NF from "../index";
import * as Lit from "@yap/shared/literals";
import * as Icit from "@yap/shared/implicitness";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";
import * as EB from "@yap/elaboration";
import { compose } from "../../unification";
const display = (value, ctx, opts = { deBruijn: false }) => {
  return match(value).with({ type: "Lit" }, ({ value: value2 }) => Lit.display(value2)).with(
    { type: "Var" },
    ({ variable }) => match(variable).with({ type: "Bound" }, ({ lvl }) => {
      const name = ctx.env[ctx.env.length - 1 - lvl]?.name.variable ?? `L${lvl}`;
      return name + (opts.deBruijn ? `#L${lvl}` : "");
    }).with({ type: "Free" }, ({ name }) => name).with({ type: "Label" }, ({ name }) => `:${name}`).with({ type: "Foreign" }, ({ name }) => `FFI.${name}`).with({ type: "Meta" }, ({ val }) => {
      const m = ctx.zonker[val] ? display(ctx.zonker[val], ctx, opts) : `?${val}`;
      return m;
    }).exhaustive()
  ).with({ type: "Neutral" }, ({ value: value2 }) => display(value2, ctx, opts)).with({ type: "Abs", binder: { type: "Mu" } }, ({ binder }) => binder.source).with({ type: "Abs" }, ({ binder, closure }) => {
    const b = match(binder).with({ type: "Lambda" }, ({ variable }) => `\u03BB${variable}`).with({ type: "Pi" }, ({ variable, annotation }) => `\u03A0(${variable}: ${display(annotation, ctx, opts)})`).with({ type: "Mu" }, ({ variable, annotation }) => `\u03BC(${variable}: ${display(annotation, ctx, opts)})`).exhaustive();
    const arr = binder.type !== "Mu" && binder.icit === "Implicit" ? "=>" : "->";
    const z = compose(ctx.zonker, closure.ctx.zonker);
    const extended = { ...closure.ctx, metas: ctx.metas, zonker: z, env: [{ name: { variable: binder.variable } }, ...closure.ctx.env] };
    const printedEnv = extended.env.map(({ nf, name }) => {
      if (nf) {
        return `${name.variable} = ${NF.display(nf, extended, opts)}`;
      }
      return name.variable;
    }).slice(1);
    let prettyEnv = printedEnv.length > 0 ? `\u0393: ${printedEnv.join("; ")}` : "\xB7";
    return `${b} ${arr} (closure: ${EB.Display.Term(closure.term, extended, opts)} -| ${prettyEnv})`;
  }).with({ type: "App" }, ({ func, arg, icit }) => {
    const f = display(func, ctx, opts);
    const a = display(arg, ctx, opts);
    const wrappedFn = func.type !== "Var" && func.type !== "Lit" && func.type !== "App" ? `(${f})` : f;
    const wrappedArg = arg.type === "Abs" || arg.type === "App" ? `(${a})` : a;
    return `${wrappedFn} ${Icit.display(icit)}${wrappedArg}`;
  }).with(
    { type: "Row" },
    ({ row }) => R.display({
      term: (term) => display(term, ctx, opts),
      var: (v) => display(NF.mk({ type: "Var", variable: v }), ctx, opts)
    })(row)
  ).with({ type: "Modal" }, ({ modalities, value: value2 }) => {
    return `<${Q.display(modalities.quantity)}> ${display(value2, ctx, opts)} [| ${display(modalities.liquid, ctx, opts)} |]`;
  }).with({ type: "External" }, (external) => {
    const args = external.args.map((arg) => `(${display(arg, ctx, opts)})`).join(" ");
    return `(${external.name}: ${args})`;
  }).exhaustive();
};
export {
  display
};
//# sourceMappingURL=pretty.mjs.map