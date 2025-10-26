import "../../chunk-ZD7AOCMD.mjs";
import { match, P } from "ts-pattern";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as EB from "@yap/elaboration";
import * as NF from ".";
import _ from "lodash";
import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";
import * as R from "@yap/shared/rows";
import * as O from "fp-ts/lib/Option";
import { Liquid } from "@yap/verification/modalities";
function evaluate(ctx, term) {
  const res = match(term).with({ type: "Lit" }, ({ value }) => NF.Constructors.Lit(value)).with({ type: "Var", variable: { type: "Label" } }, ({ variable }) => {
    const sig = ctx.sigma[variable.name];
    if (!sig) {
      throw new Error("Unbound label: " + variable.name);
    }
    return sig.nf;
  }).with({ type: "Var", variable: { type: "Free" } }, ({ variable }) => {
    const val = ctx.imports[variable.name];
    if (!val) {
      throw new Error("Unbound free variable: " + variable.name);
    }
    return evaluate(ctx, val[0]);
  }).with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) => {
    if (!ctx.zonker[variable.val]) {
      const v = NF.Constructors.Var(variable);
      return NF.Constructors.Neutral(v);
    }
    return ctx.zonker[variable.val];
  }).with({ type: "Var", variable: { type: "Bound" } }, ({ variable }) => {
    const entry = ctx.env[variable.index];
    if (entry.type[0].type === "Mu") {
      return NF.Constructors.Neutral(entry.nf);
    }
    return entry.nf;
  }).with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => {
    const val = ctx.ffi[variable.name];
    if (!val) {
      return NF.Constructors.Neutral(NF.Constructors.Var(variable));
    }
    if (val && val.arity === 0) {
      return val.compute();
    }
    const external = NF.Constructors.External(variable.name, val.arity, val.compute, []);
    return external;
  }).with({ type: "Abs", binding: { type: "Lambda" } }, ({ body, binding }) => {
    const ann = evaluate(ctx, binding.annotation);
    return NF.Constructors.Lambda(binding.variable, binding.icit, NF.Constructors.Closure(ctx, body), ann);
  }).with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }) => {
    const ann = evaluate(ctx, binding.annotation);
    return NF.Constructors.Pi(binding.variable, binding.icit, ann, NF.Constructors.Closure(ctx, body));
  }).with({ type: "Abs", binding: { type: "Mu" } }, (mu) => {
    const ann = evaluate(ctx, mu.binding.annotation);
    const val = NF.Constructors.Mu(mu.binding.variable, mu.binding.source, ann, NF.Constructors.Closure(ctx, mu.body));
    return val;
  }).with({ type: "App" }, ({ func, arg, icit }) => {
    const nff = evaluate(ctx, func);
    const nfa = evaluate(ctx, arg);
    return reduce(nff, nfa, icit);
  }).with({ type: "Row" }, ({ row }) => {
    return NF.Constructors.Row(evalRow(ctx, row));
  }).with({ type: "Match" }, (v) => {
    const scrutinee = evaluate(ctx, v.scrutinee);
    if (scrutinee.type === "Neutral" || scrutinee.type === "Var" && scrutinee.variable.type === "Meta") {
      const lambda = NF.Constructors.Lambda("_scrutinee", "Explicit", NF.Constructors.Closure(ctx, v), NF.Any);
      const app = NF.Constructors.App(lambda, scrutinee, "Explicit");
      return NF.Constructors.Neutral(app);
    }
    const res2 = matching(ctx, scrutinee, v.alternatives);
    if (!res2) {
      throw new Error("Match: No alternative matched");
    }
    return res2;
  }).with({ type: "Proj" }, ({ term: term2, label }) => {
    const base = evaluate(ctx, term2);
    const lookupRow = (row) => {
      switch (row.type) {
        case "empty":
          return { tag: "missing" };
        case "variable":
          return { tag: "blocked" };
        case "extension":
          if (row.label === label) {
            return { tag: "found", value: row.value };
          }
          return lookupRow(row.row);
      }
    };
    const attemptProject = (value) => {
      const target = unwrapNeutral(value);
      return match(target).with({ type: "Neutral" }, () => ({ tag: "blocked" })).with(NF.Patterns.Row, ({ row }) => lookupRow(row)).with(NF.Patterns.Struct, NF.Patterns.Schema, NF.Patterns.Variant, ({ arg }) => lookupRow(arg.row)).otherwise(() => ({ tag: "not-applicable" }));
    };
    const attempt = attemptProject(base);
    if (attempt.tag === "found") {
      return attempt.value;
    }
    if (attempt.tag === "missing") {
      throw new Error(`Projection: label ${label} not found`);
    }
    const binder = `$proj_${label}`;
    const body = EB.Constructors.Proj(label, EB.Constructors.Var({ type: "Bound", index: 0 }));
    const lambda = NF.Constructors.Lambda(binder, "Explicit", NF.Constructors.Closure(ctx, body), NF.Any);
    const app = NF.Constructors.App(lambda, base, "Explicit");
    return NF.Constructors.Neutral(app);
  }).with({ type: "Inj" }, ({ term: term2, label, value: valueTerm }) => {
    const base = evaluate(ctx, term2);
    const injected = evaluate(ctx, valueTerm);
    const setRowValue = (row) => {
      switch (row.type) {
        case "empty":
          return NF.Constructors.Extension(label, injected, row);
        case "variable":
          return NF.Constructors.Extension(label, injected, row);
        case "extension": {
          if (row.label === label) {
            return NF.Constructors.Extension(label, injected, row.row);
          }
          const rest = setRowValue(row.row);
          return NF.Constructors.Extension(row.label, row.value, rest);
        }
      }
    };
    const attemptInject = (value) => {
      const target = unwrapNeutral(value);
      return match(target).with({ type: "Neutral" }, () => ({ tag: "blocked" })).with(NF.Patterns.Row, ({ row }) => {
        const updated = setRowValue(row);
        return { tag: "updated", value: NF.Constructors.Row(updated) };
      }).with(NF.Patterns.Struct, NF.Patterns.Schema, NF.Patterns.Variant, (matched) => {
        const updated = setRowValue(matched.arg.row);
        const updatedRow = NF.Constructors.Row(updated);
        return { tag: "updated", value: NF.Constructors.App(matched.func, updatedRow, matched.icit) };
      }).otherwise(() => ({ tag: "not-applicable" }));
    };
    const attempt = attemptInject(base);
    if (attempt.tag === "updated") {
      return attempt.value;
    }
    const binder = `$inj_${label}`;
    const body = EB.Constructors.Inj(label, valueTerm, EB.Constructors.Var({ type: "Bound", index: 0 }));
    const lambda = NF.Constructors.Lambda(binder, "Explicit", NF.Constructors.Closure(ctx, body), NF.Any);
    const app = NF.Constructors.App(lambda, base, "Explicit");
    return NF.Constructors.Neutral(app);
  }).with({ type: "Modal" }, ({ term: term2, modalities }) => {
    const nf = evaluate(ctx, term2);
    return NF.Constructors.Modal(nf, {
      quantity: modalities.quantity,
      liquid: NF.evaluate(ctx, modalities.liquid)
    });
  }).otherwise((tm) => {
    console.log("Eval: Not implemented yet", EB.Display.Term(tm, ctx));
    throw new Error("Not implemented");
  });
  return res;
}
const reduce = (nff, nfa, icit) => match(nff).with({ type: "Neutral" }, ({ value }) => NF.Constructors.Neutral(NF.Constructors.App(value, nfa, icit))).with({ type: "Modal" }, ({ modalities, value }) => {
  console.warn("Applying a modal function. The modality of the argument will be ignored. What should happen here?");
  return reduce(value, nfa, icit);
}).with({ type: "Abs", binder: { type: "Mu" } }, (mu) => {
  return NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit));
}).with({ type: "Abs" }, ({ closure, binder }) => {
  return apply(binder, closure, nfa);
}).with({ type: "Lit", value: { type: "Atom" } }, ({ value }) => NF.Constructors.App(NF.Constructors.Lit(value), nfa, icit)).with({ type: "Var", variable: { type: "Meta" } }, (_2) => NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit))).with({ type: "Var", variable: { type: "Foreign" } }, ({ variable }) => NF.Constructors.Neutral(NF.Constructors.App(nff, nfa, icit))).with({ type: "App" }, ({ func, arg, icit: icit2 }) => {
  const nff2 = reduce(func, arg, icit2);
  return NF.Constructors.App(nff2, nfa, icit2);
}).with({ type: "External" }, ({ name, args, arity, compute }) => {
  if (arity === 0) {
    return compute();
  }
  const accumulated = [...args, nfa];
  if (accumulated.length === arity && accumulated.every((a) => a.type !== "Neutral")) {
    return compute(...accumulated.map(ignoraModal));
  }
  return NF.Constructors.External(name, arity, compute, accumulated);
}).otherwise(() => {
  throw new Error("Impossible: Tried to apply a non-function while evaluating: " + JSON.stringify(nff));
});
const matching = (ctx, nf, alts) => {
  return match(alts).with([], () => void 0).with(
    [P._, ...P.array()],
    ([alt, ...rest]) => F.pipe(
      meet(ctx, alt.pattern, nf),
      O.map((binders) => {
        const extended = binders.reduce(
          (_ctx, { binder, quantity, liquid }) => EB.extend(_ctx, binder, NF.Constructors.Modal(nf, { quantity, liquid })),
          ctx
        );
        return evaluate(extended, alt.term);
      }),
      O.getOrElse(() => matching(ctx, nf, rest))
    )
  ).exhaustive();
};
const apply = (binder, closure, value) => {
  const { ctx, term } = closure;
  const extended = EB.extend(ctx, binder, value);
  if (closure.type === "Closure") {
    return evaluate(extended, term);
  }
  const args = extended.env.slice(0, closure.arity).map(({ nf }) => nf);
  return closure.compute(...args);
};
const unwrapNeutral = (value) => {
  return match(value).with({ type: "Neutral" }, ({ value: value2 }) => unwrapNeutral(value2)).otherwise(() => value);
};
const force = (ctx, value) => {
  return match(value).with({ type: "Neutral" }, (v) => force(ctx, unwrapNeutral(v))).with(NF.Patterns.Flex, ({ variable }) => {
    if (ctx.zonker[variable.val]) {
      return force(ctx, ctx.zonker[variable.val]);
    }
    return value;
  }).otherwise(() => value);
};
const ignoraModal = (value) => {
  return match(value).with({ type: "Modal" }, ({ value: value2 }) => ignoraModal(value2)).otherwise(() => value);
};
const builtinsOps = ["+", "-", "*", "/", "&&", "||", "==", "!=", "<", ">", "<=", ">=", "%"];
const meet = (ctx, pattern, nf) => {
  const truthy = (v) => Liquid.Predicate.NeutralNF(v, ctx);
  return match([unwrapNeutral(nf), pattern]).with([P._, { type: "Wildcard" }], () => O.some([])).with([P._, { type: "Binder" }], ([v, p]) => {
    const binder = { type: "Lambda", variable: p.value };
    return O.some([{ binder, quantity: Q.Many, liquid: truthy(v) }]);
  }).with(
    [{ type: "Lit" }, { type: "Lit" }],
    ([v, p]) => _.isEqual(v.value, p.value),
    () => O.some([])
  ).with([NF.Patterns.Schema, { type: "Struct" }], [NF.Patterns.Struct, { type: "Struct" }], ([{ arg }, p]) => meetAll(ctx, p.row, arg.row)).with([NF.Patterns.Row, { type: "Row" }], ([v, p]) => {
    return meetAll(ctx, p.row, v.row);
  }).with([NF.Patterns.Variant, { type: "Variant" }], [NF.Patterns.Struct, { type: "Variant" }], ([{ arg }, p]) => {
    return meetOne(ctx, p.row, arg.row);
  }).with([NF.Patterns.HashMap, { type: "List" }], ([v, p]) => {
    console.warn("List pattern matching not yet implemented");
    return O.some([]);
  }).with(
    [NF.Patterns.Atom, { type: "Var" }],
    ([{ value: v }, { value: p }]) => v.value === p,
    () => O.some([])
  ).otherwise(() => O.none);
};
const meetAll = (ctx, pats, vals) => {
  const truthy = (v) => Liquid.Predicate.NeutralNF(v, ctx);
  return match([pats, vals]).with([{ type: "empty" }, P._], () => O.some([])).with([{ type: "variable" }, P._], ([r]) => {
    const binder = { type: "Lambda", variable: r.variable };
    return O.some([{ binder, quantity: Q.Many, liquid: truthy(NF.Any) }]);
  }).with([{ type: "extension" }, { type: "empty" }], () => O.none).with([{ type: "extension" }, { type: "variable" }], () => O.none).with([{ type: "extension" }, { type: "extension" }], ([r1, r2]) => {
    const rewritten = R.rewrite(r2, r1.label);
    if (E.isLeft(rewritten)) {
      return O.none;
    }
    if (rewritten.right.type !== "extension") {
      throw new Error("Rewritting a row extension should result in another row extension");
    }
    const { row } = rewritten.right;
    return F.pipe(
      O.Do,
      O.apS("current", meet(ctx, r1.value, rewritten.right.value)),
      O.apS("rest", meetAll(ctx, r1.row, row)),
      O.map(({ current, rest }) => current.concat(rest))
    );
  }).exhaustive();
};
const meetOne = (ctx, pats, vals) => {
  const truthy = (v) => Liquid.Predicate.NeutralNF(v, ctx);
  return match([pats, vals]).with([{ type: "empty" }, P._], () => O.none).with([{ type: "variable" }, P._], ([r]) => {
    const binder = { type: "Lambda", variable: r.variable };
    return O.some([{ binder, quantity: Q.Many, liquid: truthy(NF.Any) }]);
  }).with([{ type: "extension" }, { type: "empty" }], () => O.none).with([{ type: "extension" }, { type: "variable" }], () => O.none).with([{ type: "extension" }, { type: "extension" }], ([r1, r2]) => {
    const rewritten = R.rewrite(r2, r1.label);
    if (E.isLeft(rewritten)) {
      return meetOne(ctx, r1.row, r2);
    }
    if (rewritten.right.type !== "extension") {
      throw new Error("Rewritting a row extension should result in another row extension");
    }
    return meet(ctx, r1.value, rewritten.right.value);
  }).exhaustive();
};
const evalRow = (ctx, row) => match(row).with({ type: "empty" }, (r) => r).with({ type: "extension" }, ({ label, value: term, row: row2 }) => {
  const value = evaluate(ctx, term);
  const rest = evalRow(ctx, row2);
  return NF.Constructors.Extension(label, value, rest);
}).with({ type: "variable" }, (r) => {
  if (r.variable.type === "Meta") {
    return { type: "variable", variable: r.variable };
  }
  if (r.variable.type === "Bound") {
    const { nf } = ctx.env[r.variable.index];
    const val = unwrapNeutral(nf);
    if (val.type === "Row") {
      return val.row;
    }
    if (val.type === "Var") {
      return { type: "variable", variable: val.variable };
    }
    throw new Error("Evaluating a row variable that is not a row or a variable: " + NF.display(val, ctx));
  }
  throw new Error(`Eval Row Variable: Not implemented yet: ${JSON.stringify(r)}`);
}).otherwise(() => {
  throw new Error("Not implemented");
});
export {
  apply,
  builtinsOps,
  evaluate,
  force,
  ignoraModal,
  matching,
  reduce,
  unwrapNeutral
};
//# sourceMappingURL=evaluation.mjs.map