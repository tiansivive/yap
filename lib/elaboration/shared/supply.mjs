import "../../chunk-ZD7AOCMD.mjs";
import * as V2 from "@yap/elaboration/shared/monad.v2";
const counts = {
  meta: 0,
  var: 0
};
const resetSupply = (key) => {
  counts[key] = 0;
};
const freshMeta = function* (lvl, ann) {
  counts.meta++;
  const m = { type: "Meta", val: counts.meta, lvl };
  yield* V2.tell("meta", { meta: m, ann });
  return m;
};
const nextCount = () => {
  counts.var++;
  return counts.var;
};
export {
  freshMeta,
  nextCount,
  resetSupply
};
//# sourceMappingURL=supply.mjs.map