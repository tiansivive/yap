import "../../chunk-ZD7AOCMD.mjs";
import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";
import * as R from "@yap/shared/rows";
import fp from "lodash/fp";
import * as F from "fp-ts/function";
const collectMetasNF = (val, zonker) => {
  const ms = match(val).with(NF.Patterns.Lit, () => []).with(NF.Patterns.Flex, ({ variable }) => {
    if (!zonker[variable.val]) {
      return [variable];
    }
    return collectMetasNF(zonker[variable.val], zonker);
  }).with(NF.Patterns.Var, () => []).with(NF.Patterns.App, ({ func, arg }) => [...collectMetasNF(func, zonker), ...collectMetasNF(arg, zonker)]).with(
    NF.Patterns.Row,
    ({ row }) => R.fold(
      row,
      (val2, l, ms2) => ms2.concat(collectMetasNF(val2, zonker)),
      (v, ms2) => {
        if (v.type !== "Meta") {
          return ms2;
        }
        if (!zonker[v.val]) {
          return [v, ...ms2];
        }
        return collectMetasNF(zonker[v.val], zonker);
      },
      []
    )
  ).with({ type: "Neutral" }, ({ value }) => collectMetasNF(value, zonker)).with(NF.Patterns.Lambda, ({ closure }) => collectMetasEB(closure.term, zonker)).with(NF.Patterns.Pi, ({ closure, binder }) => [...collectMetasNF(binder.annotation, zonker), ...collectMetasEB(closure.term, zonker)]).with(NF.Patterns.Mu, ({ closure, binder }) => [...collectMetasNF(binder.annotation, zonker), ...collectMetasEB(closure.term, zonker)]).with(NF.Patterns.Modal, ({ value }) => collectMetasNF(value, zonker)).otherwise(() => {
    throw new Error("metas: Not implemented yet");
  });
  return F.pipe(
    ms,
    fp.uniqBy((m) => m.val)
  );
};
const collectMetasEB = (tm, zonker) => {
  const _metas = (tm2) => {
    const ms = match(tm2).with({ type: "Var" }, ({ variable }) => {
      if (variable.type !== "Meta") {
        return [];
      }
      if (!zonker[variable.val]) {
        return [variable];
      }
      return collectMetasNF(zonker[variable.val], zonker);
    }).with({ type: "Lit" }, () => []).with({ type: "Abs", binding: { type: "Lambda" } }, ({ body, binding }) => _metas(body)).with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }) => [..._metas(binding.annotation), ..._metas(body)]).with({ type: "Abs", binding: { type: "Mu" } }, ({ body, binding }) => [..._metas(binding.annotation), ..._metas(body)]).with({ type: "App" }, ({ func, arg }) => [..._metas(func), ..._metas(arg)]).with(
      { type: "Row" },
      ({ row }) => R.fold(
        row,
        (val, l, ms2) => ms2.concat(_metas(val)),
        (v, ms2) => v.type === "Meta" ? [...ms2, v] : ms2,
        []
      )
    ).with({ type: "Proj" }, ({ term }) => _metas(term)).with({ type: "Inj" }, ({ value, term }) => [..._metas(value), ..._metas(term)]).with({ type: "Match" }, ({ scrutinee, alternatives }) => [..._metas(scrutinee), ...alternatives.flatMap((alt) => _metas(alt.term))]).with({ type: "Block" }, ({ return: ret, statements }) => [..._metas(ret), ...statements.flatMap((s) => _metas(s.value))]).with({ type: "Modal" }, ({ term }) => _metas(term)).otherwise(() => {
      throw new Error("metas: Not implemented yet");
    });
    return ms;
  };
  return _metas(tm);
};
const collect = {
  nf: collectMetasNF,
  eb: collectMetasEB
};
export {
  collect,
  collectMetasEB,
  collectMetasNF
};
//# sourceMappingURL=metas.mjs.map