import "../chunk-ZD7AOCMD.mjs";
import { match } from "ts-pattern";
import * as E from "fp-ts/lib/Either";
const Constructors = {
  Extension: (label, value, row) => ({ type: "extension", label, value, row }),
  Variable: (variable) => ({ type: "variable", variable }),
  Empty: () => ({ type: "empty" })
};
const display = (pretty) => (row) => {
  if (row.type === "empty") {
    return "[]";
  }
  const recurse = (r) => match(r).with({ type: "empty" }, () => "").with({ type: "extension" }, ({ label, value, row: row2 }) => {
    const v = pretty.term(value);
    if (row2.type === "empty") {
      return `${label}: ${v}`;
    }
    if (row2.type === "variable") {
      return `${label}: ${v} ${recurse(row2)}`;
    }
    return `${label}: ${v}, ${recurse(row2)}`;
  }).with({ type: "variable" }, ({ variable }) => `| ${pretty.var(variable)}`).run();
  return `[ ${recurse(row)} ]`;
};
const traverse = (row, onVal, onVar) => match(row).with({ type: "empty" }, (r) => r).with({ type: "extension" }, ({ label, value, row: row2 }) => Constructors.Extension(label, onVal(value, label), traverse(row2, onVal, onVar))).with({ type: "variable" }, ({ variable }) => onVar(variable)).exhaustive();
const fold = (row, onVal, onVar, acc) => {
  const recurse = (r, acc2) => match(r).with({ type: "empty" }, () => acc2).with({ type: "extension" }, ({ label, value, row: row2 }) => recurse(row2, onVal(value, label, acc2))).with({ type: "variable" }, ({ variable }) => onVar(variable, acc2)).run();
  return recurse(row, acc);
};
const rewrite = (r, label, onVar) => {
  return match(r).with({ type: "empty" }, () => E.left({ tag: "Mismatch", label })).with(
    { type: "extension" },
    ({ label: l }) => label === l,
    ({ label: l, value, row }) => E.right(Constructors.Extension(l, value, row))
  ).with(
    { type: "extension" },
    ({ label: lbl, value: val, row }) => E.Monad.chain(
      rewrite(row, label, onVar),
      (res) => match(res).with({ type: "extension" }, ({ label: l, value: v, row: r2 }) => E.right(Constructors.Extension(l, v, Constructors.Extension(lbl, val, r2)))).otherwise(() => E.left({ tag: "ExpectedExtension" }))
    )
  ).with({ type: "variable" }, (r2) => {
    if (!onVar) {
      return E.right(r2);
    }
    return E.Functor.map(onVar(r2.variable), ([val, v]) => {
      const rvar = Constructors.Variable(v);
      const rf = Constructors.Extension(label, val, rvar);
      return rf;
    });
  }).exhaustive();
};
export {
  Constructors,
  display,
  fold,
  rewrite,
  traverse
};
//# sourceMappingURL=rows.mjs.map