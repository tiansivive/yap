import "../../../chunk-ZD7AOCMD.mjs";
import Nearley from "nearley";
import Grammar from "@yap/src/grammar";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lib from "@yap/shared/lib/primitives";
import { omit } from "lodash/fp";
const mkParser = () => {
  const g = { ...Grammar, ParserStart: "Ann" };
  return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};
const parseExpr = (src) => {
  const parser = mkParser();
  const data = parser.feed(src);
  if (data.results.length !== 1) {
    throw new Error(`Ambiguous or failed parse: expected 1 result, got ${data.results.length}`);
  }
  return data.results[0];
};
const mkCtx = () => Lib.defaultContext();
const elaborateFrom = (src) => {
  EB.resetSupply("meta");
  EB.resetSupply("var");
  const term = parseExpr(src);
  const ctx = mkCtx();
  const result = EB.V2.Do(function* () {
    const [tm2, ty2] = yield* EB.infer.gen(term);
    const { constraints: csts, metas: metas2, types: types2 } = yield* EB.V2.listen();
    const constraints2 = csts.map((c) => c.type === "assign" ? omit("trace", c) : c);
    return { tm: tm2, ty: ty2, constraints: constraints2, metas: metas2, types: types2 };
  });
  const out = result(ctx);
  if (out.result._tag === "Left") {
    throw new Error(EB.V2.display(out.result.left));
  }
  const { tm, ty, constraints, metas, types } = out.result.right;
  const pretty = {
    term: EB.Display.Term(tm, { env: ctx.env, zonker: ctx.zonker, metas: { ...ctx.metas, ...metas } }),
    type: NF.display(ty, { env: ctx.env, zonker: ctx.zonker, metas: { ...ctx.metas, ...metas } }),
    constraints: constraints.map((c) => EB.Display.Constraint(c, { env: ctx.env, zonker: ctx.zonker, metas: { ...ctx.metas, ...metas } }))
  };
  return {
    src,
    displays: pretty,
    structure: {
      term: tm,
      type: ty,
      constraints,
      metas,
      typedTerms: types
    }
  };
};
export {
  elaborateFrom,
  mkCtx,
  mkParser,
  parseExpr
};
//# sourceMappingURL=util.mjs.map