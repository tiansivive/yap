import "../../chunk-ZD7AOCMD.mjs";
import { match, P } from "ts-pattern";
import _ from "lodash";
const MULTIPLICITY = {
  Zero: "Zero",
  One: "One",
  Many: "Many"
};
const { Zero, One, Many } = MULTIPLICITY;
const SR = {
  zero: "Zero",
  one: "One",
  add(x, y) {
    return match([x, y]).with(["Many", P._], [P._, "Many"], () => "Many").with(["One", "One"], () => "Many").with(["One", P._], [P._, "One"], () => "One").otherwise(() => "Zero");
  },
  mul(x, y) {
    return match([x, y]).with(["Zero", P._], [P._, "Zero"], () => "Zero").with(["One", P._], ([, m]) => m).with([P._, "One"], ([m]) => m).otherwise(() => "One");
  }
};
const noUsage = (lvl) => Array(lvl).fill("Zero");
const multiply = (q, usages) => usages.map((u) => SR.mul(q, u));
const add = (u1, u2) => {
  return _.zipWith(u1, u2, (a = "Zero", b = "Zero") => SR.add(a, b));
};
const display = (multiplicity) => {
  return match(multiplicity).with("One", () => "1").with("Zero", () => "0").with("Many", () => "\u03C9").otherwise(() => JSON.stringify(multiplicity));
};
export {
  Many,
  One,
  SR,
  Zero,
  add,
  display,
  multiply,
  noUsage
};
//# sourceMappingURL=multiplicity.mjs.map