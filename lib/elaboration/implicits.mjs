import "../chunk-ZD7AOCMD.mjs";
import * as F from "fp-ts/lib/function";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
import { match, P } from "ts-pattern";
import _ from "lodash";
import * as Metas from "@yap/elaboration/shared/metas";
import * as R from "@yap/shared/rows";
function insert(node) {
  const [term, ty, us] = node;
  return V2.Do(function* () {
    const ctx = yield* V2.ask();
    const r = match(node).with([{ type: "Abs", binding: { type: "Lambda", icit: "Implicit" } }, P._, P._], () => V2.of(node)).with(
      [P._, { type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, P._],
      ([, pi]) => V2.Do(function* () {
        const found = yield* V2.pure(EB.resolveImplicit(pi.binder.annotation));
        if (found) {
          if (!_.isEmpty(found[1])) {
            throw new Error("insert: Found implicit with constraints; What to do here?");
          }
          const bodyNF2 = NF.apply(pi.binder, pi.closure, pi.binder.annotation);
          const tm2 = EB.Constructors.App("Implicit", term, found[0]);
          return [tm2, bodyNF2, us];
        }
        const meta = yield* EB.freshMeta(ctx.env.length, pi.binder.annotation);
        const mvar = EB.Constructors.Var(meta);
        const vNF = NF.evaluate(ctx, mvar);
        const tm = EB.Constructors.App("Implicit", term, mvar);
        const bodyNF = NF.apply(pi.binder, pi.closure, vNF);
        const r2 = yield* insert.gen([tm, bodyNF, us]);
        return r2;
      })
    ).otherwise(() => V2.of(node));
    return yield* V2.pure(r);
  });
}
insert.gen = F.flow(insert, V2.pure);
const wrapLambda = (term, ty, ctx) => {
  return match(ty).with(
    { type: "Abs", binder: { type: "Pi", icit: "Implicit" } },
    (_2) => term.type === "Abs" && (term.binding.type === "Lambda" || term.binding.type === "Pi") && term.binding.icit === "Implicit",
    (_2) => term
  ).with({ type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, (pi) => {
    const ann = NF.quote(ctx, ctx.env.length, pi.binder.annotation);
    const binding = { type: "Lambda", variable: pi.binder.variable, icit: pi.binder.icit, annotation: ann };
    return EB.Constructors.Abs(binding, wrapLambda(term, NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(0)), ctx));
  }).otherwise(() => term);
};
const generalize = (tm, ctx) => {
  const ms = Metas.collect.eb(tm, ctx.zonker);
  const charCode = 97;
  return ms.reduce(
    (tm2, m, i) => {
      return EB.Constructors.Abs(
        {
          type: "Lambda",
          icit: "Implicit",
          variable: `${String.fromCharCode(charCode + i)}`,
          annotation: NF.quote(ctx, ctx.env.length, ctx.metas[m.val].ann)
        },
        tm2
      );
    },
    tm
    //replaceMeta(tm, ms, 0, ctx),
  );
};
const instantiate = (term, ctx) => {
  return match(term).with({ type: "Var", variable: { type: "Meta" } }, (v) => {
    if (!!ctx.zonker[v.variable.val]) {
      return NF.quote(ctx, ctx.env.length, ctx.zonker[v.variable.val]);
    }
    const { ann } = ctx.metas[v.variable.val];
    return match(ann).with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => EB.Constructors.Row({ type: "empty" })).with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => EB.Constructors.Lit({ type: "Atom", value: "Any" })).with({ type: "Lit", value: { type: "Atom", value: "Any" } }, () => EB.Constructors.Lit({ type: "Atom", value: "Void" })).otherwise(() => EB.Constructors.Var(v.variable));
  }).with({ type: "Abs" }, (abs) => {
    const annotation = instantiate(abs.binding.annotation, ctx);
    const extended = EB.bind(ctx, abs.binding, NF.evaluate(ctx, annotation));
    return EB.Constructors.Abs({ ...abs.binding, annotation }, instantiate(abs.body, extended));
  }).with({ type: "App" }, (app) => EB.Constructors.App(app.icit, instantiate(app.func, ctx), instantiate(app.arg, ctx))).with({ type: "Row" }, ({ row }) => {
    const r = R.traverse(
      row,
      (val) => instantiate(val, ctx),
      (v) => R.Constructors.Variable(v)
    );
    return EB.Constructors.Row(r);
  }).with({ type: "Proj" }, ({ label, term: term2 }) => EB.Constructors.Proj(label, instantiate(term2, ctx))).with({ type: "Inj" }, ({ label, value, term: term2 }) => EB.Constructors.Inj(label, instantiate(value, ctx), instantiate(term2, ctx))).with(
    { type: "Match" },
    ({ scrutinee, alternatives }) => EB.Constructors.Match(
      instantiate(scrutinee, ctx),
      alternatives.map((alt) => {
        const xtended = alt.binders.reduce((acc, [bv, bty]) => EB.bind(acc, { type: "Let", variable: bv }, bty), ctx);
        return { pattern: alt.pattern, term: instantiate(alt.term, xtended), binders: alt.binders };
      })
    )
  ).with({ type: "Block" }, ({ return: ret, statements }) => {
    const { stmts, ctx: xtended } = statements.reduce(
      (acc, s) => {
        const { stmts: stmts2, ctx: ctx2 } = acc;
        const instantiated = { ...s, value: instantiate(s.value, ctx2) };
        if (s.type === "Let") {
          const extended = EB.bind(ctx2, { type: "Let", variable: s.variable }, s.annotation);
          return { stmts: [...stmts2, instantiated], ctx: extended };
        }
        return { stmts: [...stmts2, instantiated], ctx: ctx2 };
      },
      { stmts: [], ctx }
    );
    return EB.Constructors.Block(stmts, instantiate(ret, xtended));
  }).with({ type: "Modal" }, ({ term: term2, modalities }) => EB.Constructors.Modal(instantiate(term2, ctx), modalities)).otherwise((t) => t);
};
export {
  generalize,
  insert,
  instantiate,
  wrapLambda
};
//# sourceMappingURL=implicits.mjs.map