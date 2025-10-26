import "../../chunk-ZD7AOCMD.mjs";
import { match } from "ts-pattern";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Lit from "@yap/shared/literals";
import * as R from "@yap/shared/rows";
import { capitalize } from "lodash";
const infer = {
  Lit: V2.regen((pat) => {
    const atom = match(pat.value).with({ type: "String" }, (_) => Lit.Atom("String")).with({ type: "Num" }, (_) => Lit.Atom("Num")).with({ type: "Bool" }, (_) => Lit.Atom("Bool")).with({ type: "Atom" }, (_) => Lit.Atom("Type")).with({ type: "unit" }, (_) => Lit.Atom("Unit")).exhaustive();
    return V2.Do(function* () {
      const ctx = yield* V2.ask();
      return [EB.Constructors.Patterns.Lit(pat.value), NF.Constructors.Lit(atom), Q.noUsage(ctx.env.length), []];
    });
  }),
  Var: V2.regen(
    (pat) => V2.Do(function* () {
      const ctx = yield* V2.ask();
      const free = ctx.imports[pat.value.value];
      if (free) {
        const [tm, ty, us] = free;
        return [EB.Constructors.Patterns.Var(pat.value.value, tm), ty, us, []];
      }
      const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
      const meta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
      const va = NF.evaluate(ctx, meta);
      const zero = Q.noUsage(ctx.env.length);
      const binder = [pat.value.value, va];
      return [{ type: "Binder", value: pat.value.value }, va, zero, [binder]];
    })
  ),
  Row: V2.regen(
    (pat) => V2.Do(function* () {
      const [r, rowty, rus, binders] = yield* elaborate.gen(pat.row);
      return [EB.Constructors.Patterns.Row(r), NF.Constructors.Row(rowty), rus, binders];
    })
  ),
  Struct: V2.regen(
    (pat) => V2.Do(function* () {
      const [tm, ty, qs, binders] = yield* elaborate.gen(pat.row);
      return [EB.Constructors.Patterns.Struct(tm), NF.Constructors.Schema(ty), qs, binders];
    })
  ),
  Variant: V2.regen(
    (pat) => V2.Do(function* () {
      const ctx = yield* V2.ask();
      const [r, rowty, rus, binders] = yield* elaborate.gen(pat.row);
      const addVar = function* (nfr) {
        if (nfr.type === "empty") {
          return R.Constructors.Variable(yield* EB.freshMeta(ctx.env.length, NF.Row));
        }
        if (nfr.type === "variable") {
          return nfr;
        }
        const tail2 = yield* addVar(nfr.row);
        return R.Constructors.Extension(nfr.label, nfr.value, tail2);
      };
      const tail = yield* addVar(rowty);
      return [EB.Constructors.Patterns.Variant(r), NF.Constructors.Variant(tail), rus, binders];
    })
  ),
  Wildcard: V2.regen(
    (_) => V2.Do(function* () {
      const ctx = yield* V2.ask();
      const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
      const meta = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
      return [EB.Constructors.Patterns.Wildcard(), meta, Q.noUsage(ctx.env.length), []];
    })
  ),
  Tuple: V2.regen(
    (pat) => V2.Do(function* () {
      const [r, rowty, qs, binders] = yield* elaborate.gen(pat.row);
      return [EB.Constructors.Patterns.Struct(r), NF.Constructors.Schema(rowty), qs, binders];
    })
  ),
  List: V2.regen(
    (pat) => V2.Do(function* () {
      const ctx = yield* V2.ask();
      const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
      const mvar = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
      const v = NF.evaluate(ctx, mvar);
      const validate = (val) => V2.Do(function* () {
        const key = capitalize(val.type);
        const result = yield* infer[key].gen(val);
        yield* V2.tell("constraint", { type: "assign", left: result[1], right: v });
        return result;
      });
      const es = yield* V2.pure(V2.traverse(pat.elements, validate));
      const [pats, binders] = es.reduce(([pats2, binders2], [pat2, , , b]) => [pats2.concat(pat2), binders2.concat(b)], [[], []]);
      const indexing = NF.Constructors.App(NF.Indexed, NF.Constructors.Lit(Lit.Atom("Num")), "Explicit");
      const values = NF.Constructors.App(indexing, v, "Explicit");
      const ty = NF.Constructors.App(values, NF.Constructors.Var({ type: "Foreign", name: "defaultArray" }), "Implicit");
      return [
        EB.Constructors.Patterns.List(pats, pat.rest?.value),
        NF.Constructors.Neutral(ty),
        Q.noUsage(ctx.env.length),
        pat.rest ? binders.concat([[
          pat.rest.value,
          ty
          /*, Q.noUsage(ctx.env.length)*/
        ]]) : binders
      ];
    })
  )
};
const elaborate = V2.regen(
  (r) => V2.Do(function* () {
    const ctx = yield* V2.ask();
    const rr = yield match(r).with({ type: "empty" }, (r2) => V2.of([r2, R.Constructors.Empty(), Q.noUsage(ctx.env.length), []])).with(
      { type: "variable" },
      ({ variable }) => V2.Do(function* () {
        const meta = yield* EB.freshMeta(ctx.env.length, NF.Row);
        const zero = Q.noUsage(ctx.env.length);
        const binder = [
          variable.value,
          NF.Constructors.Var(meta)
          /*zero*/
        ];
        return [R.Constructors.Variable(variable.value), R.Constructors.Variable(meta), zero, [binder]];
      })
    ).with(
      { type: "extension" },
      ({ label, value, row }) => V2.Do(function* () {
        const key = capitalize(value.type);
        const val = yield* infer[key].gen(value);
        const r2 = yield* elaborate.gen(row);
        const q = Q.add(val[2], r2[2]);
        const ty = NF.Constructors.Extension(label, val[1], r2[1]);
        const tm = EB.Constructors.Patterns.Extension(label, val[0], r2[0]);
        const binders = [val[3], r2[3]].flat();
        return [tm, ty, q, binders];
      })
    ).otherwise((_) => {
      throw new Error("Expected Row Type");
    });
    return rr;
  })
);
export {
  infer
};
//# sourceMappingURL=patterns.mjs.map