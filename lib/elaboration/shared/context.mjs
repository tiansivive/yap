import "../../chunk-ZD7AOCMD.mjs";
import { replicate } from "fp-ts/lib/Array";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as U from "@yap/elaboration/unification/index";
import * as Sub from "@yap/elaboration/unification/substitution";
import * as F from "fp-ts/function";
import * as E from "fp-ts/Either";
import * as A from "fp-ts/Array";
import { set, update } from "@yap/utils";
const lookup = (variable, ctx) => {
  const zeros = replicate(ctx.env.length, Q.Zero);
  if (variable.type === "label") {
    const key = ctx.sigma[variable.value];
    if (key) {
      const { ann, multiplicity } = key;
      const tm = EB.Constructors.Var({ type: "Label", name: variable.value });
      return V2.of([tm, ann, zeros]);
    }
    throw new Error(`Label not found: ${variable.value}`);
  }
  const _lookup = (i, variable2, types) => {
    if (types.length === 0) {
      const free = ctx.imports[variable2.value];
      if (free) {
        const [, nf2, us] = free;
        const tm = EB.Constructors.Var({ type: "Free", name: variable2.value });
        return V2.of([tm, nf2, Q.add(us, zeros)]);
      }
      throw new Error(`Variable not found: ${variable2.value}`);
    }
    const [[binder, origin, nf], ...rest] = types;
    if (binder.variable === variable2.value) {
      const tm = EB.Constructors.Var({ type: "Bound", index: i });
      return V2.Do(function* () {
        yield* V2.tell("binder", binder);
        return [tm, nf, zeros];
      });
    }
    return _lookup(i + 1, variable2, rest);
  };
  return _lookup(
    0,
    variable,
    ctx.env.map((v) => v.type)
  );
};
lookup.gen = F.flow(lookup, V2.pure);
const resolveImplicit = (nf) => V2.Do(function* () {
  const ctx = yield* V2.ask();
  const lookup2 = (implicits) => {
    if (implicits.length === 0) {
      return;
    }
    const [[term, value], ...rest] = implicits;
    const unification = U.unify(nf, value, ctx.env.length, Sub.empty);
    const result = unification(ctx).result;
    if (E.isRight(result)) {
      return [term, result.right];
    }
    return lookup2(rest);
  };
  return lookup2(ctx.implicits);
});
resolveImplicit.gen = F.flow(resolveImplicit, V2.pure);
const bind = (context, binder, annotation, origin = "source") => {
  const { env } = context;
  const entry = {
    nf: NF.Constructors.Rigid(env.length),
    type: [binder, origin, annotation],
    name: binder
  };
  return {
    ...context,
    env: [entry, ...env]
  };
};
const extend = (context, binder, value, origin = "source") => {
  const { env } = context;
  const entry = {
    nf: value,
    type: [binder, origin, new Error("Need to implemented typed metas: Get the type from metas context")],
    name: binder
  };
  return {
    ...context,
    env: [entry, ...env]
  };
};
const augment = (context, binder, annotation, origin = "inserted") => {
  const { env } = context;
  const entry = {
    nf: NF.Constructors.Rigid(env.length),
    type: [binder, origin, annotation],
    name: binder
  };
  return {
    ...context,
    env: [...env, entry]
  };
};
const unfoldMu = (context, binder, annotation, origin = "source") => {
  const { env } = context;
  const entry = {
    nf: annotation,
    // NOTE: mu types are directly placed in the env
    type: [binder, origin, annotation],
    name: binder
  };
  return {
    ...context,
    env: [entry, ...env]
  };
};
const extendSigma = (ctx, variable, sigma) => {
  return set(ctx, ["sigma", variable], sigma);
};
const muContext = (ctx) => {
  return {
    ...ctx,
    env: ctx.env.map((e) => {
      const [b, ...rest] = e.type;
      if (b.type === "Let") {
        return { ...e, type: [{ ...b, type: "Mu" }, ...rest] };
      }
      return e;
    })
  };
};
const prune = (ctx, lvl) => {
  return update(ctx, "env", A.takeRight(lvl));
};
const lvl2idx = (ctx, lvl) => {
  return ctx.env.length - 1 - lvl;
};
export {
  augment,
  bind,
  extend,
  extendSigma,
  lookup,
  lvl2idx,
  muContext,
  prune,
  resolveImplicit,
  unfoldMu
};
//# sourceMappingURL=context.mjs.map