import "../../chunk-ZD7AOCMD.mjs";
import { match, P } from "ts-pattern";
import _ from "lodash";
import * as F from "fp-ts/lib/function";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Sub from "./substitution";
import * as Err from "@yap/elaboration/shared/errors";
import * as R from "@yap/shared/rows";
import { bind } from ".";
import * as U from "@yap/elaboration/unification";
let count = 0;
const unify = (r1, r2, s) => V2.track(
  { tag: "unify", type: "row", rows: [r1, r2], metadata: { action: "unification" } },
  V2.Do(function* () {
    const ctx = yield* V2.ask();
    const lvl = ctx.env.length;
    const subst = match([r1, r2]).with([{ type: "empty" }, { type: "empty" }], () => V2.of(s)).with(
      [{ type: "variable" }, { type: "variable" }],
      ([{ variable: v1 }, { variable: v2 }]) => _.isEqual(v1, v2),
      () => V2.of(s)
    ).with(
      [{ type: "variable", variable: { type: "Meta" } }, P._],
      ([{ variable }]) => !!s[variable.val],
      ([v, r]) => {
        const nf = s[v.variable.val];
        if (nf.type !== "Row") {
          throw new Error("Expected row");
        }
        return unify(nf.row, r, s);
      }
    ).with(
      [P._, { type: "variable", variable: { type: "Meta" } }],
      ([P_, { variable }]) => !!s[variable.val],
      ([r, v]) => {
        const nf = s[v.variable.val];
        if (nf.type !== "Row") {
          throw new Error("Expected row");
        }
        return unify(r, nf.row, s);
      }
    ).with([{ type: "variable", variable: { type: "Meta" } }, P._], ([{ variable }, r]) => V2.of(bind(ctx, variable, NF.Constructors.Row(r)))).with([P._, { type: "variable", variable: { type: "Meta" } }], ([r, { variable }]) => V2.of(bind(ctx, variable, NF.Constructors.Row(r)))).with(
      [{ type: "extension" }, P._],
      ([{ label, value, row }, r]) => V2.Do(function* () {
        count++;
        const [rewritten, o1] = yield* V2.pure(rewrite(r, label, s));
        if (rewritten.type !== "extension") {
          return yield* V2.fail(Err.Impossible("Expected extension"));
        }
        const o2 = yield* U.unify.gen(value, rewritten.value, lvl, Sub.compose(o1, s));
        const o3 = yield* unify.gen(row, rewritten.row, o2);
        return F.pipe(o3, Sub.compose(o2), Sub.compose(o1));
      })
    ).with([{ type: "empty" }, { type: "extension" }], ([r, { label }]) => V2.Do(() => V2.fail(Err.MissingLabel(label, r)))).with([{ type: "extension" }, { type: "empty" }], ([{ label }, r]) => V2.Do(() => V2.fail(Err.MissingLabel(label, r)))).otherwise((r) => {
      throw new Error(
        "Unification: Row unification is described in Daan Leijen's paper 'Extensible records with scoped labels'." + JSON.stringify(r) + "\n\nCall V2.fail()?"
      );
    });
    return yield* V2.pure(subst);
  })
);
unify.gen = (r1, r2, s) => V2.pure(unify(r1, r2, s));
const tail = (row) => match(row).with({ type: "empty" }, () => []).with({ type: "extension" }, ({ row: row2 }) => tail(row2)).with(
  { type: "variable" },
  ({ variable }) => match(variable).with({ type: "Meta" }, ({ val }) => [val]).otherwise(() => [])
).exhaustive();
const rewrite = (r, label, s) => V2.Do(function* () {
  const ctx = yield* V2.ask();
  const lvl = ctx.env.length;
  const res = match(r).with({ type: "empty" }, () => V2.Do(() => V2.fail(Err.MissingLabel(label, r)))).with(
    { type: "extension" },
    ({ label: l }) => label === l,
    ({ label: l, value, row }) => V2.of([R.Constructors.Extension(l, value, row), Sub.empty])
  ).with(
    { type: "extension" },
    ({ label: lbl, value: val, row }) => V2.Do(function* () {
      const [rewritten, sub] = yield rewrite(row, label, s);
      const res2 = yield match(rewritten).with(
        { type: "extension" },
        ({ label: l, value: v, row: r2 }) => V2.of([R.Constructors.Extension(l, v, R.Constructors.Extension(lbl, val, r2)), sub])
      ).otherwise(
        () => V2.Do(
          () => V2.fail(
            Err.Impossible("Expected extension: " + R.display({ term: (v) => NF.display(v, ctx), var: (v) => JSON.stringify(v) }))
          )
        )
      );
      return res2;
    })
  ).with(
    { type: "variable" },
    ({ variable }) => V2.Do(function* () {
      if (variable.type !== "Meta") {
        return yield* V2.fail(Err.Impossible("Expected meta variable"));
      }
      const solved = s[variable.val];
      if (solved) {
        if (solved.type !== "Row") {
          throw new Error("Expected row");
        }
        return yield* V2.pure(rewrite(solved.row, label, s));
      }
      const kvar = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
      const tvar = NF.Constructors.Var(yield* EB.freshMeta(lvl, kvar));
      const rvar = R.Constructors.Variable(yield* EB.freshMeta(lvl, NF.Row));
      const rf = R.Constructors.Extension(label, tvar, rvar);
      const sub = Sub.of(variable.val, NF.Constructors.Row(rf));
      return [rf, sub];
    })
  ).exhaustive();
  return yield* V2.pure(res);
});
export {
  unify
};
//# sourceMappingURL=rows.mjs.map