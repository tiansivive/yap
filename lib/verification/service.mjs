import "../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as A from "fp-ts/Array";
import * as E from "fp-ts/Either";
import * as F from "fp-ts/function";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Row from "@yap/shared/rows";
import { match, P } from "ts-pattern";
import { Liquid } from "./modalities";
import { isEqual } from "lodash";
import {
  OP_ADD,
  OP_AND,
  OP_DIV,
  OP_EQ,
  OP_GT,
  OP_GTE,
  OP_LT,
  OP_LTE,
  OP_MUL,
  OP_NEQ,
  OP_NOT,
  OP_OR,
  OP_SUB,
  operatorMap,
  PrimOps
} from "@yap/shared/lib/primitives";
const VerificationService = (Z3) => {
  const Sorts = {
    Int: Z3.Int.sort(),
    Num: Z3.Real.sort(),
    Bool: Z3.Bool.sort(),
    String: Z3.Sort.declare("String"),
    Unit: Z3.Sort.declare("Unit"),
    Row: Z3.Sort.declare("Row"),
    Atom: Z3.Sort.declare("Atom"),
    Type: Z3.Sort.declare("Type"),
    stringify: (sm) => match(sm).with({ Prim: P.select() }, (p) => p.name.toString()).with({ App: P.select() }, (App) => {
      const [f, a] = App;
      const fs = Sorts.stringify(f);
      const as = Sorts.stringify(a);
      return `App(${fs}, ${as})`;
    }).with({ Func: P.select() }, (Func) => {
      const [a, body] = Func;
      const as = Sorts.stringify(a);
      const bs = Sorts.stringify(body);
      return `(${as} -> ${bs})`;
    }).exhaustive()
  };
  const bumpAlpha = (s) => {
    let carry = 1;
    let res = "";
    for (let i = s.length - 1; i >= 0; i--) {
      const v = s.charCodeAt(i) - 97 + carry;
      if (v >= 26) {
        res = "a" + res;
        carry = 1;
      } else {
        res = String.fromCharCode(97 + v) + res;
        carry = 0;
      }
    }
    if (carry) {
      res = "a" + res;
    }
    return res;
  };
  let freshSeq = "a";
  const freshName = () => {
    const name = `$${freshSeq}`;
    freshSeq = bumpAlpha(freshSeq);
    return name;
  };
  const check = (tm, ty) => V2.Do(function* () {
    const ctx = yield* V2.ask();
    console.log(`Checking: ${EB.Display.Term(tm, ctx)}
Against: ${NF.display(ty, ctx)}`);
    const r = match([tm, NF.force(ctx, ty)]).with([{ type: "Modal" }, NF.Patterns.Type], ([tm2, ty2]) => check.gen(tm2.term, ty2)).with(
      [{ type: "Abs" }, { type: "Abs", binder: { type: "Pi" } }],
      ([tm2, ty2]) => V2.local(
        (ctx2) => EB.bind(ctx2, { type: "Lambda", variable: tm2.binding.variable }, ty2.binder.annotation),
        V2.Do(function* () {
          const tyBody = NF.apply(ty2.binder, ty2.closure, NF.Constructors.Rigid(ctx.env.length));
          const artefacts = yield* check.gen(tm2.body, tyBody);
          const modalities = extract(ty2.binder.annotation, yield* V2.ask());
          const [vu, ...usages] = artefacts.usages;
          yield* V2.tell("constraint", { type: "usage", expected: modalities.quantity, computed: vu });
          const sMap = mkSort(ty2.binder.annotation, ctx);
          const x = match(sMap).with({ Prim: P.select() }, (sort) => Z3.Const(tm2.binding.variable, sort)).with({ Func: P._ }, (fn) => Z3.Array.const(tm2.binding.variable, ...build(fn))).with({ App: P._ }, (app) => {
            const sort = Z3.Sort.declare(build(app).join(" "));
            return Z3.Const(tm2.binding.variable, sort);
          }).exhaustive();
          const p = modalities.liquid;
          if (p.type !== "Abs") {
            throw new Error("Liquid refinement must be a unary function");
          }
          const lvl = ctx.env.length;
          const applied = NF.apply(p.binder, p.closure, NF.Constructors.Rigid(lvl));
          const phi = translate(applied, ctx, { [lvl]: x });
          const imp = Z3.ForAll([x], Z3.Implies(phi, artefacts.vc));
          return { usages, vc: imp };
        })
      )
    ).otherwise(function* ([tm2, ty2]) {
      const [synthed, artefacts] = yield* synth.gen(tm2);
      const checked = yield* subtype.gen(synthed, ty2);
      return { usages: artefacts.usages, vc: Z3.And(artefacts.vc, checked) };
    });
    return yield* r;
  });
  check.gen = (tm, ty) => V2.pure(check(tm, ty));
  const synth = (term) => V2.Do(function* () {
    const ctx = yield* V2.ask();
    const r = match(term).with(
      { type: "Var", variable: { type: "Bound" } },
      (tm) => V2.Do(function* () {
        const entry = ctx.env[tm.variable.index];
        if (!entry) {
          throw new Error("Unbound variable in synth");
        }
        const [binder, , ty] = entry.type;
        const modalities = extract(ty, ctx);
        const zeros = A.replicate(ctx.env.length, Q.Zero);
        const usages = A.unsafeUpdateAt(tm.variable.index, modalities.quantity, zeros);
        const v = NF.evaluate(ctx, tm);
        const p = NF.reduce(modalities.liquid, v, "Explicit");
        return [ty, { usages, vc: translate(p, ctx) }];
      })
    ).with({ type: "Var", variable: { type: "Free" } }, (tm) => {
      const entry = ctx.imports[tm.variable.name];
      if (!entry) {
        throw new Error(`Unbound free variable: ${tm.variable.name}`);
      }
      const [t, ty, us] = entry;
      const modalities = extract(ty, ctx);
      const p = NF.reduce(modalities.liquid, NF.evaluate(ctx, tm), "Explicit");
      return V2.of([ty, { usages: us, vc: translate(p, ctx) }]);
    }).with({ type: "Var" }, (tm) => {
      console.warn("synth: Other variable types not implemented yet");
      return V2.of([NF.Any, { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }]);
    }).with(
      { type: "Lit" },
      (tm) => V2.Do(function* () {
        const ann = match(tm.value).with({ type: "Atom" }, (l) => EB.Constructors.Lit(l)).with({ type: "Num" }, (l) => EB.Constructors.Lit({ type: "Atom", value: "Num" })).with({ type: "String" }, (l) => EB.Constructors.Lit({ type: "Atom", value: "String" })).with({ type: "Bool" }, (l) => EB.Constructors.Lit({ type: "Atom", value: "Bool" })).with({ type: "unit" }, (l) => EB.Constructors.Lit({ type: "Atom", value: "Unit" })).exhaustive();
        const nf = NF.evaluate(ctx, ann);
        const bound = EB.Constructors.Var({ type: "Bound", index: 0 });
        const fresh = freshName();
        const closure = NF.Constructors.Closure(ctx, EB.DSL.eq(bound, tm));
        const modalities = {
          quantity: Q.Many,
          liquid: NF.Constructors.Lambda(fresh, "Explicit", closure, nf)
        };
        return [NF.Constructors.Modal(nf, modalities), { usages: Q.noUsage(ctx.env.length), vc: Z3.Bool.val(true) }];
      })
    ).with(
      { type: "Abs" },
      (tm) => V2.Do(function* () {
        const ann = NF.evaluate(ctx, tm.binding.annotation);
        const [, bArtefacts] = yield* V2.local((_ctx) => EB.bind(_ctx, { type: "Pi", variable: tm.binding.variable }, ann), synth(tm.body));
        const icit = tm.binding.type === "Lambda" || tm.binding.type === "Pi" ? tm.binding.icit : "Explicit";
        const type = NF.Constructors.Pi(tm.binding.variable, icit, ann, NF.Constructors.Closure(ctx, tm.body));
        return [type, { usages: bArtefacts.usages, vc: Z3.Bool.val(true) }];
      })
    ).with(EB.CtorPatterns.Struct, EB.CtorPatterns.Variant, EB.CtorPatterns.Schema, (rowtype) => {
      throw new Error("synth: Row based verification not implemented yet");
    }).with(
      { type: "App" },
      (tm) => V2.Do(function* () {
        const fn = yield* synth.gen(tm.func);
        const [fnTy, fnArtefacts] = fn;
        const forced = NF.force(ctx, fnTy);
        const modalities = extract(forced, ctx);
        const [out, usages, vc] = yield* V2.pure(
          match(forced).with(
            { type: "Abs", binder: { type: "Pi" } },
            (ty) => V2.Do(function* () {
              const checked = yield* check.gen(tm.arg, ty.binder.annotation);
              const us = Q.add(fnArtefacts.usages, Q.multiply(modalities.quantity, checked.usages));
              const vc2 = Z3.And(fnArtefacts.vc, checked.vc);
              const nf = NF.evaluate(ctx, tm.arg);
              const out2 = NF.apply(ty.binder, ty.closure, nf);
              return [out2, us, vc2];
            })
          ).otherwise((ty) => {
            console.error("Got: ", NF.display(ty, ctx));
            throw new Error("Impossible: Function type expected in application");
          })
        );
        return [out, { usages, vc }];
      })
    ).with({ type: "Block" }, (block) => {
      const recurse = (stmts, results) => V2.Do(function* () {
        if (stmts.length === 0) {
          return yield* synth.gen(block.return);
        }
        const [current, ...rest] = stmts;
        if (current.type === "Expression") {
          const synthed = yield* synth.gen(current.value);
          const r2 = yield* V2.pure(recurse(rest, [...results, synthed[1]]));
          return r2;
        }
        if (current.type !== "Let") {
          return yield* V2.pure(recurse(rest, [...results]));
        }
        return yield* V2.local(
          (ctx2) => EB.bind(ctx2, { type: "Let", variable: current.variable }, current.annotation),
          V2.Do(function* () {
            const artefacts = yield* check.gen(current.value, current.annotation);
            const [ty, conj] = yield* V2.pure(recurse(rest, [...results, artefacts]));
            return [ty, { usages: conj.usages, vc: Z3.And(artefacts.vc, conj.vc) }];
          })
        );
      });
      return recurse(block.statements, []);
    }).otherwise(() => {
      console.warn("synth: Not implemented yet");
      return V2.of([NF.Any, { usages: Q.noUsage(0), vc: Z3.Bool.val(true) }]);
    });
    const ret = yield* V2.pure(r);
    return ret;
  });
  synth.gen = (tm) => V2.pure(synth(tm));
  const extract = (nf, ctx) => match(nf).with({ type: "Modal" }, (m) => m.modalities).otherwise(() => ({
    quantity: Q.Many,
    liquid: Liquid.Predicate.NeutralNF(NF.Constructors.Lit({ type: "Atom", value: "Unit" }), ctx)
  }));
  const subtype = (a, b) => V2.Do(function* () {
    const ctx = yield* V2.ask();
    const s = match([NF.unwrapNeutral(a), NF.unwrapNeutral(b)]).with([NF.Patterns.Flex, P._], ([meta, t]) => {
      const ty = ctx.zonker[meta.variable.val];
      if (!ty) {
        throw new Error("Unbound meta variable in subtype");
      }
      return subtype(ty, t);
    }).with([P._, NF.Patterns.Flex], ([t, meta]) => {
      const ty = ctx.zonker[meta.variable.val];
      if (!ty) {
        throw new Error("Unbound meta variable in subtype");
      }
      return subtype(t, ty);
    }).with(
      [NF.Patterns.Rigid, P._],
      ([rigid, t]) => t.type !== "Var" || t.variable.type !== "Bound" || rigid.variable.lvl !== t.variable.lvl,
      ([{ variable }, bt]) => V2.Do(function* () {
        const ty = ctx.env[variable.lvl];
        if (!ty) {
          throw new Error("Unbound variable in subtype");
        }
        return yield* subtype.gen(ty.nf, bt);
      })
    ).with(
      [P._, NF.Patterns.Rigid],
      ([at, { variable }]) => at.type !== "Var" || at.variable.type !== "Bound" || variable.lvl !== at.variable.lvl,
      ([at, { variable }]) => V2.Do(function* () {
        const ty = ctx.env[variable.lvl];
        if (!ty) {
          throw new Error("Unbound variable in subtype");
        }
        return yield* subtype.gen(at, ty.nf);
      })
    ).with([NF.Patterns.Schema, NF.Patterns.Schema], ([{ arg: a2 }, { arg: b2 }]) => {
      return contains(b2.row, a2.row);
    }).with([NF.Patterns.Variant, NF.Patterns.Variant], ([{ arg: a2 }, { arg: b2 }]) => {
      return contains(a2.row, b2.row);
    }).with(
      [{ type: "Modal" }, { type: "Modal" }],
      ([at, bt]) => V2.Do(function* () {
        const ctx2 = yield* V2.ask();
        const baseVc = yield* subtype.gen(at.value, bt.value);
        const pAt = at.modalities.liquid;
        const pBt = bt.modalities.liquid;
        if (pAt.type !== "Abs" || pBt.type !== "Abs") {
          throw new Error("Liquid refinements must be unary functions");
        }
        const lvl = ctx2.env.length;
        const appliedAt = NF.apply(pAt.binder, pAt.closure, NF.Constructors.Rigid(lvl));
        const appliedBt = NF.apply(pBt.binder, pBt.closure, NF.Constructors.Rigid(lvl));
        const sortMap = mkSort(at.value, ctx2);
        const xSort = match(sortMap).with({ Prim: P.select() }, (p) => p).otherwise(() => {
          throw new Error("Only primitive types can be used in logical formulas");
        });
        const fresh = freshName();
        const x = Z3.Const(fresh, xSort);
        const rigids = { [lvl]: x };
        const phiAt = translate(appliedAt, ctx2, rigids);
        const phiBt = translate(appliedBt, ctx2, rigids);
        const forall = Z3.ForAll([x], Z3.Implies(phiAt, phiBt));
        return Z3.And(baseVc, forall);
      })
    ).with([{ type: "Modal" }, P._], ([at, bt]) => subtype(at, NF.Constructors.Modal(bt, { quantity: Q.Zero, liquid: Liquid.Predicate.NeutralNF(bt, ctx) }))).with([P._, { type: "Modal" }], ([at, bt]) => subtype(NF.Constructors.Modal(at, { quantity: Q.Many, liquid: Liquid.Predicate.NeutralNF(at, ctx) }), bt)).with(
      [
        { type: "Abs", binder: { type: "Pi" } },
        { type: "Abs", binder: { type: "Pi" } }
      ],
      ([at, bt]) => V2.Do(function* () {
        const vcArg = yield* subtype.gen(bt.binder.annotation, at.binder.annotation);
        const ctx2 = yield* V2.ask();
        const anf = NF.apply(at.binder, at.closure, NF.Constructors.Rigid(ctx2.env.length));
        const bnf = NF.apply(bt.binder, bt.closure, NF.Constructors.Rigid(ctx2.env.length));
        const vcBody = yield* subtype.gen(anf, bnf);
        const vc = Z3.Implies(vcArg, vcBody);
        return vc;
      })
    ).with([NF.Patterns.Lit, NF.Patterns.Lit], ([{ value: v1 }, { value: v2 }]) => {
      return V2.of(Z3.Bool.val(isEqual(v1, v2)));
    }).otherwise(
      ([a2, b2]) => V2.Do(function* () {
        const ctx2 = yield* V2.ask();
        console.warn("Subtype not fully implemented yet");
        console.log("A:", NF.display(a2, ctx2));
        console.log(a2);
        console.log("B:", NF.display(b2, ctx2));
        console.log(b2);
        console.log(ctx2.zonker);
        return Z3.Bool.val(false);
      })
    );
    const r = yield* V2.pure(s);
    return r;
  });
  subtype.gen = (a, b) => V2.pure(subtype(a, b));
  const contains = (a, b) => {
    const onVal = (v, lbl, conj) => {
      const ra = Row.rewrite(a, lbl, (v2) => E.left({ tag: "Other", message: `Could not rewrite row. Label ${lbl} not found.` }));
      return F.pipe(
        ra,
        E.fold(
          (err) => V2.Do(() => V2.fail({ type: "MissingLabel", label: lbl, row: a })),
          (rewritten) => {
            if (rewritten.type !== "extension") {
              throw new Error("Verification Subtyping: Expected extension after rewriting row");
            }
            return V2.Do(function* () {
              const accumulated = yield* V2.pure(conj);
              const vc = yield* subtype.gen(v, rewritten.value);
              return Z3.And(accumulated, vc);
            });
          }
        )
      );
    };
    return Row.fold(b, onVal, (rv, acc) => acc, V2.of(Z3.Bool.val(true)));
  };
  const mkFunction = (val, ctx) => {
    return match(val).with(NF.Patterns.Var, ({ variable }) => {
      const getNameAndType = (variable2) => {
        if (variable2.type === "Bound") {
          const {
            type: [, , type2],
            name: name2
          } = ctx.env[EB.lvl2idx(ctx, variable2.lvl)];
          return { name: name2.variable, type: type2 };
        }
        if (variable2.type === "Free") {
          const [, type2] = ctx.imports[variable2.name];
          return { name: variable2.name, type: type2 };
        }
        if (variable2.type === "Label") {
          const { ann } = ctx.sigma[variable2.name];
          return { name: variable2.name, type: ann };
        }
        if (variable2.type === "Foreign") {
          if (!(variable2.name in PrimOps)) {
            throw new Error("MKFunc: Foreign variables should not appear in logical formulas");
          }
          const [, type2] = ctx.imports[operatorMap[variable2.name]];
          return { name: variable2.name, type: type2 };
        }
        if (variable2.type === "Meta") {
          const m = ctx.metas[variable2.val];
          if (!m) {
            throw new Error("MKFunc: Meta variables should not appear in logical formulas");
          }
          return { name: `?${variable2.val}`, type: m.ann };
        }
        throw new Error("MKFunc: Unknown variable type");
      };
      const { name, type } = getNameAndType(variable);
      const sort = mkSort(type, ctx);
      const all = build(sort);
      const f = Z3.Array.const(name, ...all);
      return f;
    }).with(NF.Patterns.App, (a) => mkFunction(a.func, ctx)).with({ type: "External" }, (e) => {
      if (e.args.length !== e.arity) {
        throw new Error("External with wrong arity in logical formulas");
      }
      const args = e.args.flatMap((arg) => build(mkSort(arg, ctx)));
      const f = Z3.Array.const(e.name, ...args);
      return f;
    }).with({ type: "Abs" }, (a) => {
      throw new Error("Function literals not supported in logical formulas");
    }).otherwise(() => {
      throw new Error("Not a function");
    });
  };
  const translate = (nf, ctx, rigids = {}) => {
    const collectArgs = (value, ctx2) => {
      return match(value).with(NF.Patterns.App, ({ func, arg }) => {
        const fs = collectArgs(func, ctx2);
        const a = translate(arg, ctx2, rigids);
        return fs.concat(a);
      }).otherwise(() => [translate(value, ctx2, rigids)]);
    };
    const r = match(nf).with({ type: "Neutral" }, (n) => translate(n.value, ctx, rigids)).with({ type: "Modal" }, (m) => translate(m.value, ctx, rigids)).with(
      NF.Patterns.Lit,
      (l) => match(l.value).with({ type: "Num" }, (l2) => Z3.Real.val(l2.value)).with({ type: "Bool" }, (l2) => Z3.Bool.val(l2.value)).with({ type: "String" }, (l2) => {
        throw new Error("String literals not supported yet");
      }).with({ type: "unit" }, (l2) => Z3.Const("unit", Sorts.Unit)).with({ type: "Atom" }, (atom) => Z3.Const(atom.value, Sorts.Atom)).exhaustive()
    ).with(NF.Patterns.Row, (r2) => {
      throw new Error("Row literals not supported yet");
    }).with({ type: "Abs" }, (a) => {
      throw new Error("Function literals not supported in logical formulas");
    }).with(NF.Patterns.App, (fn) => {
      const f = mkFunction(fn.func, ctx);
      const [, ...args] = collectArgs(fn, ctx);
      const call = f.select(args[0], ...args.slice(1));
      return call;
    }).with(NF.Patterns.Var, (v) => {
      if (v.variable.type === "Bound") {
        const mapped = rigids[v.variable.lvl];
        if (mapped) {
          return mapped;
        }
        const {
          nf: nf2,
          name,
          type: [, , type]
        } = ctx.env[EB.lvl2idx(ctx, v.variable.lvl)];
        const all = build(mkSort(type, ctx));
        const sort = all.length === 1 ? all[0] : Z3.Sort.declare(all.join(" -> "));
        return Z3.Const(name.variable, sort);
      }
      if (v.variable.type === "Free") {
        const [a] = ctx.imports[v.variable.name];
        return translate(NF.evaluate(ctx, a), ctx, rigids);
      }
      if (v.variable.type === "Label") {
        const { nf: nf2 } = ctx.sigma[v.variable.name];
        return translate(nf2, ctx, rigids);
      }
      if (v.variable.type === "Foreign") {
        throw new Error("Translation Error: Foreign variables should not appear in logical formulas");
      }
      if (v.variable.type === "Meta") {
        throw new Error("Translation Error: Meta variables should not appear in logical formulas");
      }
      throw new Error("Translation Error: Unknown variable type");
    }).with({ type: "External" }, (e) => {
      if (e.args.length !== e.arity) {
        throw new Error("External with wrong arity in logical formulas");
      }
      const args = e.args.map((arg) => translate(arg, ctx, rigids));
      const r2 = (() => {
        if (e.name === OP_ADD) {
          return args[0].add(args[1]);
        }
        if (e.name === OP_SUB) {
          return args[0].sub(args[1]);
        }
        if (e.name === OP_MUL) {
          return args[0].mul(args[1]);
        }
        if (e.name === OP_DIV) {
          return args[0].div(args[1]);
        }
        if (e.name === OP_AND) {
          return Z3.And(args[0], args[1]);
        }
        if (e.name === OP_OR) {
          return Z3.Or(args[0], args[1]);
        }
        if (e.name === OP_NOT) {
          return args[0].not();
        }
        if (e.name === OP_EQ) {
          return args[0].eq(args[1]);
        }
        if (e.name === OP_NEQ) {
          return args[0].neq(args[1]);
        }
        if (e.name === OP_GT) {
          return args[0].gt(args[1]);
        }
        if (e.name === OP_GTE) {
          return args[0].ge(args[1]);
        }
        if (e.name === OP_LT) {
          return args[0].lt(args[1]);
        }
        if (e.name === OP_LTE) {
          return args[0].le(args[1]);
        }
        throw new Error(`Unknown external function in logical formulas: ${e.name}`);
      })();
      return r2;
    }).otherwise((x) => {
      throw new Error("Unknown expression type");
    });
    return r;
  };
  const mkSort = (nf, ctx) => {
    const s = match(nf).with({ type: "Neutral" }, (n) => mkSort(n.value, ctx)).with({ type: "Modal" }, (m) => mkSort(m.value, ctx)).with(
      NF.Patterns.Lit,
      (l) => match(l.value).with({ type: "Atom" }, ({ value }) => ({ Prim: Sorts[value] || Sorts.Atom })).otherwise((_) => {
        throw new Error("Unknown literal type");
      })
      // .exhaustive()
    ).with(NF.Patterns.Row, (r) => ({ Prim: Sorts.Row })).with(NF.Patterns.App, ({ func, arg }) => ({ App: [mkSort(func, ctx), mkSort(arg, ctx)] })).with({ type: "Abs" }, ({ binder, closure }) => {
      const body = NF.apply(binder, closure, NF.Constructors.Rigid(ctx.env.length));
      const argSort = mkSort(binder.annotation, ctx);
      const retSort = mkSort(body, ctx);
      return { Func: [argSort, retSort] };
    }).with({ type: "External" }, (e) => {
      return { Prim: Z3.Sort.declare(`External:${e.name}`) };
    }).with(NF.Patterns.Var, (v) => {
      const { type } = v.variable;
      if (type === "Bound") {
        return mkSort(ctx.env[v.variable.lvl].nf, ctx);
      }
      if (type === "Meta") {
        const ty = ctx.zonker[v.variable.val];
        if (!ty) {
          throw new Error("Unconstrained meta variable in verification");
        }
        return mkSort(ty, ctx);
      }
      if (type === "Free") {
        return { Prim: Z3.Sort.declare(v.variable.name) };
      }
      if (type === "Foreign") {
        return { Prim: Z3.Sort.declare(v.variable.name) };
      }
      if (type === "Label") {
        return { Prim: Z3.Sort.declare(v.variable.name) };
      }
      throw new Error("Could not create sort from variable");
    }).exhaustive();
    return s;
  };
  const build = (s) => match(s).with({ Prim: P.select() }, (p) => [p]).with({ App: P.select() }, (App) => {
    const [f, a] = App;
    const fs = build(f).map((s2) => s2.name);
    const as = build(a).map((s2) => s2.name);
    const sort = Z3.Sort.declare(`App(${fs.join(",")}, ${as.join(",")})`);
    return [sort];
  }).with({ Func: P.select() }, (Func) => {
    const [a, body] = Func;
    const as = build(a);
    const bs = build(body);
    return as.concat(bs);
  }).exhaustive();
  return { check, synth, subtype };
};
export {
  VerificationService
};
//# sourceMappingURL=service.mjs.map