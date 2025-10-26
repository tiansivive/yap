import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";
import * as F from "fp-ts/lib/function";
import * as R from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import { match } from "ts-pattern";
const infer = (struct) => V2.track({ tag: "src", type: "term", term: struct, metadata: { action: "infer", description: "Struct" } }, commonStructInference(struct.row));
infer.gen = F.flow(infer, V2.pure);
const commonStructInference = (row) => V2.Do(function* () {
  const ctx = yield* V2.ask();
  const { fields, tail } = yield* EB.Rows.inSigmaContext.gen(row, EB.Rows.collect(row));
  const mkRows = (start) => fields.reduceRight(
    ([rtm, rty], { label, term, value }) => [R.Constructors.Extension(label, term, rtm), R.Constructors.Extension(label, value, rty)],
    start
  );
  if (!tail) {
    const [rtm, rty] = mkRows([R.Constructors.Empty(), R.Constructors.Empty()]);
    return [EB.Constructors.Struct(rtm), NF.Constructors.Schema(rty), Q.noUsage(ctx.env.length)];
  }
  const [tm, ty] = yield* match(tail.ty).with({ type: "Lit", value: { type: "Atom", value: "Row" } }, function* () {
    const rtm = fields.reduceRight((r, { label, term }) => R.Constructors.Extension(label, term, r), R.Constructors.Variable(tail.variable));
    return [EB.Constructors.Schema(rtm), NF.Type];
  }).with(NF.Patterns.Schema, function* (s) {
    const [rtm, rty] = mkRows([R.Constructors.Variable(tail.variable), s.arg.row]);
    return [EB.Constructors.Struct(rtm), NF.Constructors.Schema(rty)];
  }).with(NF.Patterns.Flex, function* (meta) {
    const freshRowMeta = yield* EB.freshMeta(ctx.env.length, NF.Row);
    const schemaTy = NF.Constructors.Schema(R.Constructors.Variable(freshRowMeta));
    yield* V2.tell("constraint", { type: "assign", left: meta, right: schemaTy });
    const [rtm, rty] = mkRows([R.Constructors.Variable(tail.variable), R.Constructors.Variable(freshRowMeta)]);
    return [EB.Constructors.Struct(rtm), NF.Constructors.Schema(rty)];
  }).otherwise(() => {
    throw new Error("Elaborating Struct: Tail type is neither Schema, Row nor Flex");
  });
  return [tm, ty, Q.noUsage(ctx.env.length)];
});
export {
  commonStructInference,
  infer
};
//# sourceMappingURL=structs.mjs.map