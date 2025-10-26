import "../../chunk-ZD7AOCMD.mjs";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as U from "@yap/elaboration/unification";
import { match, P } from "ts-pattern";
import * as Sub from "@yap/elaboration/unification/substitution";
import * as Err from "@yap/elaboration/shared/errors";
import * as F from "fp-ts/lib/function";
const solve = (cs) => V2.Do(function* () {
  const ctx = yield* V2.ask();
  const solution = yield* V2.pure(_solve(cs, ctx, Sub.empty));
  return solution;
});
const _solve = (cs, _ctx, subst) => {
  if (cs.length === 0) {
    return V2.of(subst);
  }
  const [c, ...rest] = cs;
  return match(c).with(
    { type: "assign" },
    ({ left, right, lvl }) => V2.Do(function* () {
      const sub = yield* V2.local(F.identity, V2.track(c.trace, U.unify(left, right, lvl, subst)));
      const sol = yield _solve(rest, _ctx, sub);
      return sol;
    })
  ).with({ type: "usage" }, ({ expected, computed }) => {
    return match([expected, computed]).with(["One", "One"], ["Many", P._], ["Zero", "Zero"], () => _solve(rest, _ctx, subst)).otherwise(() => V2.Do(() => V2.fail(Err.MultiplicityMismatch(expected, computed))));
  }).otherwise(() => {
    throw new Error("Solve: Not implemented yet");
  });
};
export {
  solve
};
//# sourceMappingURL=solver.mjs.map