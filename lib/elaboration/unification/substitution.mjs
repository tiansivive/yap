import "../../chunk-ZD7AOCMD.mjs";
import * as NF from "@yap/elaboration/normalization";
const Substitution = Symbol("Substitution");
const empty = { [Substitution]: void 0 };
const of = (k, v) => ({ [k]: v, [Substitution]: void 0 });
const from = (record) => ({ ...record, [Substitution]: void 0 });
const display = (subst, metas, separator = "\n") => {
  if (Object.keys(subst).length === 0) {
    return "empty";
  }
  return Object.entries(subst).map(([key, value]) => `?${key} |=> ${NF.display(value, { zonker: subst, metas, env: [] })}`).join(separator);
};
function compose(...args) {
  const _compose = (newer, old) => ({ ...old, ...newer });
  if (args.length === 1) {
    return (newer) => _compose(newer, args[0]);
  }
  return _compose(args[0], args[1]);
}
export {
  compose,
  display,
  empty,
  from,
  of
};
//# sourceMappingURL=substitution.mjs.map