import "../../chunk-ZD7AOCMD.mjs";
import * as NF from "../normalization";
import * as Q from "@yap/shared/modalities/multiplicity";
import { match } from "ts-pattern";
import * as Icit from "@yap/shared/implicitness";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
import * as EB from "..";
import { options } from "@yap/shared/config/options";
const display = (term, ctx, opts = { deBruijn: false, printEnv: false }) => {
  const bind = (name) => {
    return { ...ctx, env: [{ name: { variable: name } }, ...ctx.env] };
  };
  const _display = (term2) => {
    return match(term2).with({ type: "Lit" }, ({ value }) => Lit.display(value)).with(
      { type: "Var" },
      ({ variable }) => match(variable).with({ type: "Bound" }, ({ index }) => {
        const name = ctx.env[index]?.name.variable ?? `I${index}`;
        return name + (opts.deBruijn ? `#I${index}` : "");
      }).with({ type: "Free" }, ({ name }) => name).with({ type: "Foreign" }, ({ name }) => `FFI.${name}`).with({ type: "Label" }, ({ name }) => `:${name}`).with({ type: "Meta" }, ({ val }) => {
        if (ctx.zonker[val]) {
          return NF.display(ctx.zonker[val], ctx, opts);
        }
        const { ann } = ctx.metas[val];
        return options.verbose ? `(?${val} :: ${NF.display(ann, ctx, opts)})` : `?${val}`;
      }).otherwise(() => "Var _display: Not implemented")
    ).with({ type: "Abs", binding: { type: "Mu" } }, ({ binding, body }) => {
      if (!options.verbose) {
        return binding.source;
      }
      return `([\u03BC = ${binding.source}](${binding.variable}: ${_display(binding.annotation)})) -> ${display(body, bind(binding.variable), opts)}`;
    }).with({ type: "Abs" }, ({ binding, body }) => {
      const b = match(binding).with({ type: "Lambda" }, ({ variable }) => `\u03BB${variable}`).with({ type: "Pi" }, ({ variable, annotation }) => `\u03A0(${variable}: ${_display(annotation)})`).otherwise(() => {
        throw new Error("_display Term Binder: Not implemented");
      });
      const arr = binding.type !== "Let" && binding.type !== "Mu" && binding.icit === "Implicit" ? "=>" : "->";
      const xtended = bind(binding.variable);
      const printedEnv = xtended.env.map(({ nf, name }) => {
        if (nf) {
          return `${name.variable} = ${NF.display(nf, xtended, opts)}`;
        }
        return name.variable;
      }).join("; ");
      if (opts.printEnv) {
        return `(${b} ${arr} ${display(body, bind(binding.variable), opts)} -| \u0393 = ${printedEnv})`;
      }
      return `${b} ${arr} ${display(body, bind(binding.variable), opts)}`;
    }).with({ type: "App" }, ({ icit, func, arg }) => {
      const f = _display(func);
      const a = _display(arg);
      const wrappedFn = func.type !== "Var" && func.type !== "Lit" && func.type !== "App" ? `(${f})` : f;
      const wrappedArg = arg.type === "Abs" || arg.type === "App" ? `(${a})` : a;
      return `${wrappedFn} ${Icit.display(icit)}${wrappedArg}`;
    }).with(
      { type: "Row" },
      ({ row }) => R.display({
        term: _display,
        var: (v) => _display(EB.Constructors.Var(v))
      })(row)
    ).with({ type: "Proj" }, ({ label, term: term3 }) => `(${_display(term3)}).${label}`).with({ type: "Inj" }, ({ label, value, term: term3 }) => `{ ${_display(term3)} | ${label} = ${_display(value)} }`).with({ type: "Match" }, ({ scrutinee, alternatives }) => {
      const scut = _display(scrutinee);
      const alts = alternatives.map((a) => Alt.display(a, ctx, opts)).join("\n");
      return `match ${scut}
${alts}`;
    }).with({ type: "Block" }, ({ statements, return: ret }) => {
      const stmts = statements.map((s) => Stmt.display(s, ctx, opts)).join("; ");
      return `{ ${stmts}; return ${_display(ret)}; }`;
    }).with({ type: "Modal" }, ({ term: term3, modalities }) => {
      return `<${Q.display(modalities.quantity)}> ${_display(term3)} [| ${_display(modalities.liquid)} |]`;
    }).exhaustive();
  };
  return _display(term);
};
const displayConstraint = (constraint, ctx, opts = { deBruijn: false }) => {
  if (constraint.type === "assign") {
    return `${NF.display(constraint.left, ctx, opts)} ~~ ${NF.display(constraint.right, ctx, opts)}`;
  }
  if (constraint.type === "usage") {
    return `${Q.display(constraint.computed)} <= ${Q.display(constraint.expected)}`;
  }
  return "Unknown Constraint";
};
const displayContext = (context, opts = { deBruijn: false }) => {
  const pretty = {
    env: context.env.map(({ nf, type: [binder, origin, mv], name }) => ({
      nf: NF.display(nf, context, opts),
      type: `${displayBinder(binder.type)} ${binder.variable} (${origin}): ${NF.display(mv, context, opts)}`,
      name
    })),
    imports: context.imports
  };
  return pretty;
};
const displayBinder = (binder) => {
  return match(binder).with("Let", () => "def").with("Lambda", () => "\u03BB").with("Pi", () => "\u03A0").with("Mu", () => "\u03BC").otherwise(() => "Binder Display: Not implemented");
};
const Alt = {
  display: (alt, ctx, opts = { deBruijn: false }) => {
    const xtended = alt.binders.reduce((acc, [b]) => ({ ...acc, env: [{ name: { variable: b } }, ...acc.env] }), ctx);
    return `| ${Pat.display(alt.pattern)} -> ${display(alt.term, xtended, opts)}`;
  }
};
const Pat = {
  display: (pat) => {
    return match(pat).with({ type: "Lit" }, ({ value }) => Lit.display(value)).with({ type: "Var" }, ({ value }) => `Imports.${value}`).with({ type: "Binder" }, ({ value }) => value).with(
      { type: "Row" },
      ({ row }) => R.display({
        term: Pat.display,
        var: (v) => v
      })(row)
    ).with({ type: "Struct" }, ({ row }) => {
      const r = R.display({
        term: Pat.display,
        var: (v) => v
      })(row);
      return `Struct ${r}`;
    }).with({ type: "Variant" }, ({ row }) => {
      const r = R.display({
        term: Pat.display,
        var: (v) => v
      })(row);
      return `Variant ${r}`;
    }).with({ type: "List" }, ({ patterns, rest }) => {
      const pats = patterns.map(Pat.display).join(", ");
      const r = rest ? ` | ${rest}` : "";
      return `[ ${pats}${r} ]`;
    }).with({ type: "Wildcard" }, () => "_").otherwise(() => "Pattern Display: Not implemented");
  }
};
const Stmt = {
  display: (stmt, ctx, opts = { deBruijn: false }) => {
    return match(stmt).with({ type: "Expression" }, ({ value }) => display(value, ctx, opts)).with({ type: "Let" }, ({ variable, value, annotation }) => `let ${variable}
	: ${NF.display(annotation, ctx, opts)}
	= ${display(value, ctx, opts)}`).otherwise(() => "Statement Display: Not implemented");
  }
};
const Display = {
  Term: display,
  Constraint: displayConstraint,
  Context: displayContext,
  Alternative: Alt.display,
  Pattern: Pat.display,
  Statement: Stmt.display
};
export {
  Display
};
//# sourceMappingURL=pretty.mjs.map