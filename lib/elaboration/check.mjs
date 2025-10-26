import "../chunk-ZD7AOCMD.mjs";
import { match, P } from "ts-pattern";
import * as F from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";
import * as EB from ".";
import * as NF from "./normalization";
import * as V2 from "./shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";
import { freshMeta } from "./shared/supply";
import _ from "lodash";
import { extract } from "./inference/rows";
import { entries, set } from "@yap/utils";
import * as Err from "./shared/errors";
import { Liquid } from "@yap/verification/modalities";
const check = (term, type) => V2.track(
  { tag: "src", type: "term", term, metadata: { action: "checking", against: type } },
  V2.Do(function* () {
    const ctx = yield* V2.ask();
    const result = match([term, type]).with(
      [{ type: "hole" }, P._],
      () => V2.Do(function* () {
        const k = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
        return [EB.Constructors.Var(yield* freshMeta(ctx.env.length, k)), []];
      })
    ).with(
      [{ type: "lambda" }, { type: "Abs", binder: { type: "Pi" } }],
      ([tm2, ty]) => tm2.icit === ty.binder.icit,
      ([tm2, ty]) => V2.Do(function* () {
        const bType = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));
        const ann = tm2.annotation ? (yield* EB.check.gen(tm2.annotation, ty.binder.annotation))[0] : NF.quote(ctx, ctx.env.length, ty.binder.annotation);
        return yield* V2.local(
          (ctx2) => EB.bind(ctx2, { type: "Lambda", variable: tm2.variable }, ty.binder.annotation),
          V2.Do(function* () {
            const [body, us2] = yield* Check.val.gen(tm2.body, bType);
            return [EB.Constructors.Lambda(tm2.variable, tm2.icit, body, ann), us2];
          })
        );
      })
    ).with(
      [P._, { type: "Abs", binder: { type: "Pi" } }],
      ([_2, ty]) => ty.binder.icit === "Implicit",
      ([tm2, ty]) => V2.Do(() => {
        const ann = NF.quote(ctx, ctx.env.length, ty.binder.annotation);
        return V2.local(
          (ctx2) => EB.bind(ctx2, { type: "Lambda", variable: ty.binder.variable }, ty.binder.annotation, "inserted"),
          V2.Do(function* () {
            const bType = NF.apply(ty.binder, ty.closure, NF.Constructors.Rigid(ctx.env.length));
            const [_tm, us2] = yield* Check.val.gen(tm2, bType);
            const [vu] = us2;
            return [EB.Constructors.Lambda(ty.binder.variable, "Implicit", _tm, ann), us2];
          })
        );
      })
    ).with(
      [{ type: "variant" }, NF.Patterns.Type],
      ([{ row }]) => V2.Do(function* () {
        const [r, us2] = yield* Check.row.gen(row, NF.Type, ctx.env.length);
        return [EB.Constructors.Variant(r), us2];
      })
    ).with(
      [{ type: "tuple" }, NF.Patterns.Type],
      ([{ row }]) => V2.Do(function* () {
        const [r, us2] = yield* Check.row.gen(row, NF.Type, ctx.env.length);
        return [EB.Constructors.Schema(r), us2];
      })
    ).with(
      [{ type: "struct" }, NF.Patterns.Type],
      ([{ row }]) => V2.Do(function* () {
        const [r, us2] = yield* Check.row.gen(row, NF.Type, ctx.env.length);
        return [EB.Constructors.Schema(r), us2];
      })
    ).with(
      [{ type: "injection" }, NF.Patterns.Type],
      ([inj, ty]) => V2.Do(function* () {
        const [tm2, us2] = yield* Check.val.gen(inj.value, ty);
        const [checked] = yield* Check.val.gen(inj.term, ty);
        return [EB.Constructors.Inj(inj.label, tm2, checked), us2];
      })
    ).with(
      [{ type: "struct" }, NF.Patterns.HashMap],
      ([struct, hashmap]) => V2.Do(function* () {
        const [r, us2] = yield* Check.row.gen(struct.row, hashmap.value.func.arg, ctx.env.length);
        yield* V2.tell("constraint", {
          type: "assign",
          left: hashmap.value.arg,
          right: NF.Constructors.Var({ type: "Foreign", name: "defaultHashMap" }),
          lvl: ctx.env.length
        });
        return [EB.Constructors.Struct(r), us2];
      })
    ).with(
      [{ type: "struct" }, NF.Patterns.Schema],
      ([tm2, val]) => V2.Do(function* () {
        const bindings = yield* extract(tm2.row, ctx.env.length);
        const [r, us2] = yield* V2.local(
          (ctx2) => entries(bindings).reduce((ctx3, [label, mv]) => EB.extendSigma(ctx3, label, mv), ctx2),
          Check.row.traverse(tm2.row, val.arg.row, Q.noUsage(ctx.env.length), bindings)
        );
        return [EB.Constructors.Struct(r), us2];
      })
    ).with([{ type: "match" }, NF.Patterns.Type], ([match2, ty]) => {
      return V2.Do(function* () {
        const ast = yield* EB.infer.gen(match2.scrutinee);
        const alternatives = yield* V2.pure(
          V2.traverse(
            match2.alternatives,
            EB.Inference.Match.elaborate(
              ast,
              (src) => V2.Do(function* () {
                const [tm3, us2] = yield* EB.check.gen(src, ty);
                return [tm3, ty, us2];
              })
            )
          )
        );
        const [scrutinee, , sus] = ast;
        const tm2 = EB.Constructors.Match(
          scrutinee,
          alternatives.map(([alt]) => alt)
        );
        return [tm2, sus];
      });
    }).with(
      [
        { type: "lit", value: { type: "Num" } },
        { type: "Lit", value: { type: "Num" } }
      ],
      ([tm2, val]) => {
        if (tm2.value.value === val.value.value) {
          return V2.of([EB.Constructors.Lit(tm2.value), Q.noUsage(ctx.env.length)]);
        }
        return V2.Do(() => V2.fail(Err.TypeMismatch(NF.Constructors.Lit(tm2.value), val)));
      }
    ).with([{ type: "lit", value: { type: "Num" } }, NF.Patterns.Type], ([tm2, _2]) => {
      return V2.of([EB.Constructors.Lit(tm2.value), Q.noUsage(ctx.env.length)]);
    }).with([P._, { type: "Modal" }], ([tm2, val]) => Check.val(tm2, val.value)).with(
      [{ type: "modal" }, P._],
      ([tm2, val]) => V2.Do(function* () {
        const [checked, us2] = yield* Check.val.gen(tm2.term, val);
        const liquid = tm2.modalities.liquid ? yield* EB.Liquid.typecheck(tm2.modalities.liquid, NF.evaluate(ctx, checked)) : Liquid.Predicate.Neutral(checked);
        const quantity = tm2.modalities.quantity ?? Q.Many;
        return [EB.Constructors.Modal(checked, { liquid, quantity }), us2];
      })
    ).otherwise(
      ([src, ty]) => V2.Do(
        () => V2.local(
          (ctx2) => _.isEqual(ty, NF.Type) ? EB.muContext(ctx2) : ctx2,
          V2.Do(function* () {
            const ast = yield* EB.infer.gen(src);
            const [tm2, inferred, us2] = yield* EB.Icit.insert.gen(ast);
            yield* V2.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
            return [tm2, us2];
          })
        )
      )
    );
    const [tm, us] = yield* V2.pure(result);
    return [tm, us];
  })
);
const checkRow = (row, ty, lvl) => EB.Rows.inSigmaContext(
  row,
  R.fold(
    row,
    (val, lbl, acc) => V2.Do(function* () {
      const ctx = yield* V2.ask();
      const [tm, us] = yield* Check.val.gen(val, ty);
      const sigma = ctx.sigma[lbl];
      if (!sigma) {
        throw new Error("Elaborating Row Extension: Label not found");
      }
      const nf = NF.evaluate(ctx, tm);
      yield* V2.tell("constraint", [
        { type: "assign", left: nf, right: sigma.nf, lvl: ctx.env.length },
        { type: "assign", left: ty, right: sigma.ann, lvl: ctx.env.length }
      ]);
      const [r, usages] = yield acc;
      return [{ type: "extension", label: lbl, value: tm, row: r }, Q.add(us, usages)];
    }),
    ({ value }) => {
      throw new Error("Not implemented yet: Cannot have row var in a map value");
    },
    V2.of([{ type: "empty" }, Q.noUsage(lvl)])
  )
);
const traverseRow = (r1, r2, us, bindings) => V2.Do(function* () {
  const result = match([r1, r2]).with([{ type: "empty" }, { type: "empty" }], () => V2.lift([{ type: "empty" }, us])).with([{ type: "empty" }, { type: "variable" }], () => V2.lift([{ type: "empty" }, us])).with([{ type: "empty" }, { type: "extension" }], ([r, { label }]) => V2.fail(Err.MissingLabel(label, r))).with([{ type: "variable" }, P._], () => V2.fail({ type: "Impossible", message: "Cannot have row var in a struct value" })).with([{ type: "extension" }, { type: "extension" }], ([{ label, value, row }, r]) => {
    const rewritten = R.rewrite(r, label);
    if (E.isLeft(rewritten)) {
      return V2.fail(Err.MissingLabel(label, r));
    }
    if (rewritten.right.type !== "extension") {
      return V2.fail({ type: "Impossible", message: "Rewritting a row extension should result in another row extension" });
    }
    const { value: rv, row: rr } = rewritten.right;
    return V2.local(
      (ctx) => set(ctx, `sigma.${label}.ann`, rv),
      V2.Do(function* () {
        const [tm, tus] = yield* Check.val.gen(value, rv);
        const sigma = bindings[label];
        if (!sigma) {
          throw new Error("Elaborating Row Extension: Label not found");
        }
        const ctx = yield* V2.ask();
        const nf = NF.evaluate(ctx, tm);
        yield* V2.tell("constraint", [
          { type: "assign", left: nf, right: sigma.nf, lvl: ctx.env.length }
          // NOTE: Since in this case, we already know the type, we can remove the sigma check.
          // This also prevents emitting constraints of lambdas without inserted implicits against implicit pi types
          // QUESTION: Can we simplify the bindings extraction?
          //{ type: "assign", left: rv, right: sigma.ann, lvl: ctx.env.length }
        ]);
        const [rt, rus] = yield* Check.row.traverse.gen(row, rr, us, bindings);
        const q = Q.add(tus, rus);
        const xtension = EB.Constructors.Extension(label, tm, rt);
        return [xtension, q];
      })
    );
  }).with([{ type: "extension" }, P._], ([{ label }, r]) => V2.fail(Err.MissingLabel(label, r))).otherwise((r) => {
    throw new Error("Unknown row action");
  });
  return yield* result;
});
const Check = {
  val: check,
  row: checkRow
};
check.gen = F.flow(check, V2.pure);
checkRow.gen = F.flow(checkRow, V2.pure);
checkRow.traverse = traverseRow;
traverseRow.gen = F.flow(traverseRow, V2.pure);
export {
  Check,
  check
};
//# sourceMappingURL=check.mjs.map