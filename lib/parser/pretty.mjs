import "../chunk-ZD7AOCMD.mjs";
import { match } from "ts-pattern";
import * as Lit from "@yap/shared/literals";
import * as Icit from "@yap/shared/implicitness";
import * as R from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
const display = (term) => {
  return match(term).with({ type: "lit" }, ({ value }) => Lit.display(value)).with({ type: "var" }, ({ variable }) => variable.value).with({ type: "hole" }, (_) => "?").with({ type: "arrow" }, ({ lhs, rhs, icit }) => {
    return `${Icit.display(icit)}${display(lhs)} ${arr(icit)} ${display(rhs)}`;
  }).with({ type: "lambda" }, ({ icit, variable, annotation, body }) => {
    const ann = annotation ? `: ${display(annotation)}` : "";
    return `\u03BB(${variable}${ann}) ${arr(icit)} ${display(body)}`;
  }).with({ type: "pi" }, ({ icit, variable, annotation, body }) => {
    return `\u03A0(${variable}: ${display(annotation)}) ${arr(icit)} ${display(body)}`;
  }).with({ type: "application" }, ({ icit, fn, arg }) => {
    const f = display(fn);
    const a = display(arg);
    const wrappedFn = fn.type !== "var" && fn.type !== "lit" && fn.type !== "application" ? `(${f})` : f;
    const wrappedArg = arg.type === "lambda" || arg.type === "pi" || arg.type === "arrow" || arg.type === "annotation" || arg.type === "application" || arg.type === "match" ? `(${a})` : a;
    return `${wrappedFn} ${Icit.display(icit)}${wrappedArg}`;
  }).with({ type: "annotation" }, ({ term: term2, ann }) => {
    return `(${display(term2)} : ${display(ann)})`;
  }).with({ type: "row" }, ({ row }) => {
    return R.display({
      term: display,
      var: (v) => v.value
    })(row);
  }).with({ type: "tuple" }, ({ row }) => {
    const r = R.display({
      term: display,
      var: (v) => v.value
    })(row);
    return `tuple ${r}`;
  }).with({ type: "struct" }, ({ row }) => {
    const r = R.display({
      term: display,
      var: (v) => v.value
    })(row);
    return `struct ${r}`;
  }).with({ type: "variant" }, ({ row }) => {
    const r = R.display({
      term: display,
      var: (v) => v.value
    })(row);
    return `variant ${r}`;
  }).with({ type: "tagged" }, ({ tag, term: term2 }) => {
    return `(tagged ${tag}: ${display(term2)})`;
  }).with({ type: "list" }, ({ elements }) => {
    return `[ ${elements.map(display).join(", ")} ]`;
  }).with({ type: "projection" }, ({ term: term2, label }) => {
    return `(${display(term2)}).${label}`;
  }).with({ type: "injection" }, ({ label, value, term: term2 }) => {
    return `{ ${display(term2)} | ${label} = ${display(value)} }`;
  }).with({ type: "match" }, ({ scrutinee, alternatives }) => {
    const scut = display(scrutinee);
    const alts = alternatives.map(Alt.display).join("\n");
    return `match ${scut}
${alts}`;
  }).with({ type: "block" }, ({ statements, return: ret }) => {
    const stmts = statements.map(Stmt.display).join(";\n");
    return `{
${stmts}
return ${ret ? display(ret) : ""};
}`;
  }).with({ type: "modal" }, ({ term: term2, modalities }) => {
    const tm = display(term2);
    const q = modalities.quantity ? `${Q.display(modalities.quantity)} ` : "";
    const l = modalities.liquid ? ` [| ${display(modalities.liquid)} |]` : "";
    return `${q}${tm}${l}`;
  }).otherwise((tm) => `Display Term ${tm.type}: Not implemented`);
};
const arr = (icit) => icit === "Implicit" ? "=>" : "->";
const Alt = {
  display: (alt) => `| ${Pat.display(alt.pattern)} -> ${display(alt.term)}`
};
const Pat = {
  display: (pat) => {
    return match(pat).with({ type: "lit" }, ({ value }) => Lit.display(value)).with({ type: "var" }, ({ value }) => value.value).with(
      { type: "row" },
      ({ row }) => R.display({
        term: Pat.display,
        var: (v) => v.value
      })(row)
    ).with({ type: "struct" }, ({ row }) => {
      const r = R.display({
        term: Pat.display,
        var: (v) => v.value
      })(row);
      return `Struct ${r}`;
    }).with({ type: "variant" }, ({ row }) => {
      const r = R.display({
        term: Pat.display,
        var: (v) => v.value
      })(row);
      return `Variant ${r}`;
    }).with({ type: "tuple" }, ({ row }) => {
      const r = R.display({
        term: Pat.display,
        var: (v) => v.value
      })(row);
      return `Tuple ${r}`;
    }).with({ type: "list" }, ({ elements, rest }) => {
      const els = elements.map(Pat.display).join(", ");
      const r = rest ? ` | ${rest.value}` : "";
      return `[ ${els}${r} ]`;
    }).otherwise(() => "Pattern Display: Not implemented");
  }
};
const Stmt = {
  display: (stmt) => {
    return match(stmt).with({ type: "expression" }, ({ value }) => display(value)).with({ type: "let" }, ({ variable, annotation, value, multiplicity }) => {
      const ann = annotation ? `: ${display(annotation)}` : "";
      const mul = multiplicity ? `${multiplicity} ` : "";
      return `let ${mul}${variable}${ann} = ${display(value)}`;
    }).otherwise(() => "Statement Display: Not implemented");
  }
};
export {
  Alt,
  Pat,
  Stmt,
  display
};
//# sourceMappingURL=pretty.mjs.map