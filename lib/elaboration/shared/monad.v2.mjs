import "../../chunk-ZD7AOCMD.mjs";
import * as E from "fp-ts/Either";
import * as F from "fp-ts/function";
import * as A from "fp-ts/Array";
import * as Errors from "./errors";
import * as P from "./provenance";
const concat = (fa, fb) => ({
  constraints: fa.constraints.concat(fb.constraints),
  binders: fa.binders.concat(fb.binders),
  metas: { ...fa.metas, ...fb.metas },
  types: { ...fa.types, ...fb.types }
});
const empty = { constraints: [], binders: [], metas: {}, types: {} };
const display = (err) => {
  const cause = Errors.display(err, err.ctx.zonker, err.ctx.metas);
  const prov = err.provenance ? P.display(err.provenance, { cap: 100 }, err.ctx.zonker, err.ctx.metas) : "";
  return prov ? `${cause}

Trace:
${prov}` : cause;
};
function fmap(...args) {
  if (args.length === 1) {
    const [f2] = args;
    return (fa2) => ({ ...fa2, result: E.Functor.map(fa2.result, f2) });
  }
  const [fa, f] = args;
  return { ...fa, result: E.Functor.map(fa.result, f) };
}
function chain(...args) {
  const _chain = (fa2, f2) => {
    if (E.isLeft(fa2.result)) {
      return fa2;
    }
    const next = f2(fa2.result.right);
    const final = concat(fa2, next);
    return { ...final, result: next.result };
  };
  if (args.length === 1) {
    const [f2] = args;
    return (fa2) => _chain(fa2, f2);
  }
  const [fa, f] = args;
  return _chain(fa, f);
}
const track = (provenance, fa) => (ctx) => {
  const extended = { ...ctx, trace: ctx.trace.concat(provenance) };
  return fa(extended);
};
const fold = (f, initial, as) => {
  return as.reduce(
    (e, a, i) => Do(function* () {
      const acc = yield e;
      return yield f(acc, a, i);
    }),
    of(initial)
  );
};
const traverse = (as, f) => {
  return fold(
    (acc, a, i) => Do(function* () {
      const b = yield f(a, i);
      return A.append(b)(acc);
    }),
    [],
    as
  );
};
const mkCollector = (a) => ({
  ...empty,
  result: E.right(a)
});
const of = (a) => (ctx) => mkCollector(a);
const ask = function* () {
  return yield mkCollector;
};
const asks = function* (fn) {
  return yield F.flow(fn, mkCollector);
};
function local(...args) {
  if (args.length === 1) {
    const [modify2] = args;
    return (ma2) => function* () {
      const b = yield (ctx) => ma2(modify2(ctx));
      return b;
    }();
  }
  const [modify, ma] = args;
  return function* () {
    const a = yield (ctx) => ma(modify(ctx));
    return a;
  }();
}
const tell = function* (channel, payload) {
  const ctx = yield* ask();
  const many = Array.isArray(payload) ? payload : [payload];
  const addProvenance = (cs) => cs.map((c) => ({ ...c, trace: ctx.trace }));
  const writer = (() => {
    if (channel === "constraint") {
      const cs = many.map((c) => {
        if (c.type !== "assign") {
          return c;
        }
        return { ...c, lvl: ctx.env.length };
      });
      return { constraints: addProvenance(cs), binders: [], metas: {}, types: {} };
    }
    if (channel === "binder") {
      return { constraints: [], binders: many, metas: {}, types: {} };
    }
    if (channel === "meta") {
      return {
        constraints: [],
        binders: [],
        metas: many.reduce((m, { meta, ann }) => ({ ...m, [meta.val]: { meta, ann } }), {}),
        types: {}
      };
    }
    if (channel === "type") {
      return {
        constraints: [],
        binders: [],
        metas: {},
        types: many.reduce((m, { term, nf, modalities }) => ({ ...m, [term.id]: { nf, modalities } }), {})
      };
    }
    console.warn("Tell: unknown channel:", channel);
    console.warn("Continuing without telling anything");
    return empty;
  })();
  return yield* pure((ctx2) => ({ ...writer, result: E.right(void 0) }));
};
const listen = function* () {
  return yield (_, w = { constraints: [], binders: [], metas: {}, types: {} }) => mkCollector(w);
};
const fail = function* (cause) {
  const ctx = yield* ask();
  return yield* liftE(E.left({ ...cause, provenance: ctx.trace, ctx }));
};
const lift = function* (a) {
  return yield (_) => mkCollector(a);
};
const liftC = function* (c) {
  return yield (_) => c;
};
const liftE = (e) => {
  return liftC({ ...empty, result: e });
};
const pure = function* (ma) {
  return yield ma;
};
const regen = (f) => {
  const gen = F.flow(f, pure);
  return Object.assign(f, { gen });
};
function Do(gen) {
  return (ctx) => {
    const it = gen();
    let collected = empty;
    let state = it.next();
    while (!state.done) {
      const ma = state.value(ctx, collected);
      collected = concat(collected, ma);
      if (E.isLeft(ma.result)) {
        return ma;
      }
      state = it.next(ma.result.right);
    }
    const result = mkCollector(state.value);
    result.binders = collected.binders;
    result.constraints = collected.constraints;
    result.metas = collected.metas;
    result.types = collected.types;
    return result;
  };
}
export {
  Do,
  ask,
  asks,
  chain,
  display,
  fail,
  fmap,
  fold,
  lift,
  liftC,
  liftE,
  listen,
  local,
  mkCollector,
  of,
  pure,
  regen,
  tell,
  track,
  traverse
};
//# sourceMappingURL=monad.v2.mjs.map