import "../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";
import { set, update } from "@yap/utils";
import { solve } from "./solver";
import * as A from "fp-ts/lib/Array";
import * as Sub from "@yap/elaboration/unification/substitution";
const elaborate = (mod, ctx) => {
  const maybeExport = (name) => (result2) => {
    if (mod.exports.type === "*" || mod.exports.type === "explicit" && mod.exports.names.includes(name) || mod.exports.type === "partial" && !mod.exports.hiding.includes(name)) {
      return update(result2, "exports", A.append(name));
    }
    return result2;
  };
  const next = (stmts, ctx2) => {
    if (stmts.length === 0) {
      return { foreign: [], exports: [], letdecs: [], errors: [] };
    }
    const [head, ...tail] = stmts;
    if (head.type === "using") {
      return F.pipe(
        using(head, ctx2),
        E.match(
          (e) => update(next(tail, ctx2), "errors", A.prepend(e)),
          (ctx3) => next(tail, ctx3)
        )
      );
    }
    if (head.type === "foreign") {
      const [name, result2] = foreign(head, ctx2);
      return F.pipe(
        result2,
        E.match(
          (e) => update(next(tail, ctx2), "foreign", A.prepend([name, E.left(e)])),
          ([ast, ctx3]) => F.pipe(next(tail, ctx3), update("foreign", A.prepend([name, E.right(ast)])), maybeExport(name))
        )
      );
    }
    if (head.type === "let") {
      const foo = letdec(head, ctx2);
      const [name, result2] = foo;
      return F.pipe(
        result2,
        E.match(
          (e) => update(next(tail, ctx2), "letdecs", A.prepend([name, E.left(e)])),
          ([ast, ctx3]) => F.pipe(next(tail, ctx3), update("letdecs", A.prepend([name, E.right(ast)])), maybeExport(name))
        )
      );
    }
    console.warn("Unrecognized statement", head);
    return next(tail, ctx2);
  };
  const result = next(mod.content.script, ctx);
  console.log("\n================ Module Elaboration ================\n");
  console.log("Exports:");
  console.log(result.exports);
  console.log("Foreigns:");
  console.log(result.foreign);
  console.log("Let Declarations:");
  console.log(result.letdecs);
  console.log("Errors:");
  console.log(result.errors);
  console.log("\n===================================================\n");
  return result;
};
const foreign = (stmt, ctx) => {
  const check = EB.check(stmt.annotation, NF.Type);
  const { result } = check(ctx);
  const e = E.Functor.map(result, ([tm, us]) => {
    const nf = NF.evaluate(ctx, tm);
    const v = EB.Constructors.Var({ type: "Foreign", name: stmt.variable });
    return [[v, nf, us], set(ctx, ["imports", stmt.variable], [v, nf, us])];
  });
  return [stmt.variable, e];
};
const using = (stmt, ctx) => {
  const infer = EB.Stmt.infer(stmt);
  const { result } = infer(ctx);
  return E.Functor.map(result, ([t, ty]) => update(ctx, "implicits", A.append([t.value, ty])));
};
const letdec = (stmt, ctx) => {
  const inference = V2.Do(function* () {
    const [elaborated, ty, us] = yield* EB.Stmt.infer.gen(stmt);
    const { constraints, metas } = yield* V2.listen();
    const subst = yield* V2.local(
      update("metas", (ms) => ({ ...ms, ...metas })),
      solve(constraints)
    );
    const zonked = F.pipe(
      ctx,
      update("metas", (prev) => ({ ...prev, ...metas })),
      set("zonker", Sub.compose(subst, ctx.zonker))
    );
    const [generalized, next] = NF.generalize(ty, zonked);
    const instantiated = NF.instantiate(generalized, next);
    const xtended = EB.bind(next, { type: "Let", variable: stmt.variable }, instantiated);
    const wrapped = F.pipe(
      EB.Icit.instantiate(elaborated.value, xtended),
      (inst) => EB.Icit.generalize(inst, xtended),
      (tm) => EB.Icit.wrapLambda(tm, ty, xtended)
    );
    console.log("\n------------------ LETDEC --------------------------------");
    console.log("Elaborated:\n", EB.Display.Statement(elaborated, xtended));
    console.log("Wrapped:\n", EB.Display.Term(wrapped, xtended));
    console.log("Instantiated:\n", NF.display(instantiated, xtended));
    const ast = [wrapped, instantiated, us];
    return [ast, set(next, ["imports", stmt.variable], ast)];
  });
  const { result } = inference(ctx);
  return [stmt.variable, result];
};
const expression = (stmt, ctx) => {
  const inference = V2.Do(function* () {
    const [elaborated, ty, us] = yield* EB.infer.gen(stmt.value);
    const { constraints, metas } = yield* V2.listen();
    const subst = yield* V2.local(
      update("metas", (ms) => ({ ...ms, ...metas })),
      solve(constraints)
    );
    console.log("Substitution:\n", Sub.display(subst, metas));
    const zonked = F.pipe(
      ctx,
      update("metas", (prev) => ({ ...prev, ...metas })),
      set("zonker", Sub.compose(subst, ctx.zonker))
    );
    const [generalized, next] = NF.generalize(ty, zonked);
    const instantiated = NF.instantiate(generalized, next);
    const wrapped = F.pipe(
      EB.Icit.instantiate(elaborated, next),
      (inst) => EB.Icit.generalize(inst, next),
      (tm) => EB.Icit.wrapLambda(tm, ty, next)
    );
    return [wrapped, instantiated, us, subst];
  });
  const { result } = inference(ctx);
  return result;
};
export {
  elaborate,
  expression,
  foreign,
  letdec,
  using
};
//# sourceMappingURL=module.mjs.map