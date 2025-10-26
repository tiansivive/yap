import "../../chunk-ZD7AOCMD.mjs";
import * as F from "fp-ts/lib/function";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as NF from "@yap/elaboration/normalization";
import * as Lit from "@yap/shared/literals";
const infer = (block) => V2.track(
  { tag: "src", type: "term", term: block, metadata: { action: "infer", description: "Block statements" } },
  (() => {
    const { statements, return: ret } = block;
    const recurse = (stmts, results) => V2.Do(function* () {
      if (stmts.length === 0) {
        return yield* inferReturn(block, results);
      }
      const [current, ...rest] = stmts;
      const [stmt, sty, sus] = yield* EB.Stmt.infer.gen(current);
      if (stmt.type !== "Let") {
        return yield* V2.pure(recurse(rest, [...results, stmt]));
      }
      return yield* V2.local(
        (ctx) => EB.bind(ctx, { type: "Let", variable: stmt.variable }, sty),
        V2.Do(function* () {
          const [tm, ty, [vu, ...rus]] = yield* V2.pure(recurse(rest, [...results, stmt]));
          yield* V2.tell("constraint", { type: "usage", expected: Q.Many, computed: vu });
          return [tm, ty, Q.add(rus, Q.multiply(Q.Many, sus))];
        })
      );
    });
    return recurse(statements, []);
  })()
);
const inferReturn = function* ({ return: ret }, results) {
  if (!ret) {
    const ty2 = NF.Constructors.Lit(Lit.Atom("Unit"));
    const unit = EB.Constructors.Lit(Lit.Atom("unit"));
    const tm = EB.Constructors.Block(results, unit);
    const { env } = yield* V2.ask();
    return [tm, ty2, Q.noUsage(env.length)];
  }
  const [t, ty, rus] = yield* EB.infer.gen(ret);
  return [EB.Constructors.Block(results, t), ty, rus];
};
infer.gen = F.flow(infer, V2.pure);
export {
  infer
};
//# sourceMappingURL=block.mjs.map