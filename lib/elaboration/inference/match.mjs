import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import { Patterns } from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import * as F from "fp-ts/function";
import { match } from "ts-pattern";
const infer = (tm) => V2.track(
  { tag: "src", type: "term", term: tm, metadata: { action: "infer", description: "Match" } },
  V2.Do(function* () {
    const ctx = yield* V2.ask();
    const ast = yield* EB.infer.gen(tm.scrutinee);
    const alternatives = yield V2.traverse(tm.alternatives, elaborate(ast, EB.infer));
    const common = alternatives[0][1];
    yield V2.traverse(alternatives, ([alt, ty, us], i) => {
      const provenance = [
        {
          tag: "alt",
          alt: tm.alternatives[i],
          metadata: {
            action: "alternative",
            type: ty,
            motive: `attempting to unify with previous alternative of type ${NF.display(ty, ctx)}:	${Src.Alt.display(tm.alternatives[i])}`
          }
        },
        { tag: "src", type: "term", term: tm.alternatives[i].term, metadata: { action: "infer", description: "" } }
      ];
      return V2.track(
        provenance,
        V2.Do(() => V2.tell("constraint", { type: "assign", left: ty, right: common, lvl: ctx.env.length }))
      );
    });
    const [scrutinee, scuty, sus] = ast;
    const match2 = EB.Constructors.Match(
      scrutinee,
      alternatives.map(([alt]) => alt)
    );
    const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
    const matchTy = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
    const constraints = alternatives.map(([, ty]) => ({ type: "assign", left: ty, right: matchTy, lvl: ctx.env.length }));
    yield* V2.tell("constraint", constraints);
    return [match2, matchTy, sus];
  })
);
infer.gen = F.flow(infer, V2.pure);
const elaborate = ([scrutinee, scuty, sus], action) => (alt) => V2.track(
  { tag: "alt", alt, metadata: { action: "alternative", motive: "elaborating pattern", type: scuty } },
  (() => {
    const extend = (binders) => (ctx_) => binders.reduce((ctx, [name, va]) => EB.bind(ctx, { type: "Lambda", variable: name }, va), ctx_);
    const inferAltBy = (key) => (alt2) => V2.Do(function* () {
      const [pat, patty, patus, binders] = yield* Patterns.infer[key].gen(alt2.pattern);
      yield* V2.tell("constraint", { type: "assign", left: patty, right: scuty });
      const node = yield* V2.local(
        extend(binders),
        V2.Do(function* () {
          const [branch, branty, brus] = yield action(alt2.term);
          return [EB.Constructors.Alternative(pat, branch, binders), branty, brus];
        })
      );
      return node;
    });
    const r = match(alt).with({ pattern: { type: "lit" } }, inferAltBy("Lit")).with({ pattern: { type: "var" } }, inferAltBy("Var")).with({ pattern: { type: "struct" } }, inferAltBy("Struct")).with({ pattern: { type: "variant" } }, inferAltBy("Variant")).with({ pattern: { type: "list" } }, inferAltBy("List")).otherwise((alt2) => {
      throw new Error(`Pattern Matching for ${alt2.pattern.type}: Not implemented`);
    });
    return r;
  })()
);
export {
  elaborate,
  infer
};
//# sourceMappingURL=match.mjs.map