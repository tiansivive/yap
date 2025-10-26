import "../../chunk-ZD7AOCMD.mjs";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
const UnificationFailure = (left, right) => ({ type: "UnificationFailure", left, right });
const RigidVariableMismatch = (left, right) => ({ type: "RigidVariableMismatch", left, right });
const RowMismatch = (left, right, reason) => ({ type: "RowMismatch", left, right, reason });
const TypeMismatch = (left, right) => ({ type: "TypeMismatch", left, right });
const Impossible = (message, extra) => ({ type: "Impossible", message, extra });
const MissingLabel = (label, row) => ({ type: "MissingLabel", label, row });
const MultiplicityMismatch = (expected, right, reason) => ({
  type: "MultiplicityMismatch",
  expected,
  right,
  reason
});
const display = (error, zonker, metas) => {
  const ctx = { zonker, metas, env: [] };
  switch (error.type) {
    case "UnificationFailure":
      return `Unification Failure: Cannot unify ${NF.display(error.left, ctx)} with ${NF.display(error.right, ctx)}`;
    case "RigidVariableMismatch":
      return `Variable Mismatch: Cannot unify ${NF.display(error.left, ctx)} with ${NF.display(error.right, ctx)}`;
    case "RowMismatch":
      return `Row Mismatch: Cannot unify
${R.display({ term: (v) => NF.display(v, ctx), var: (v) => JSON.stringify(v) })(error.left)}
with
${R.display({ term: (v) => NF.display(v, ctx), var: (v) => JSON.stringify(v) })(error.right)}.
Reason: ${error.reason}`;
    case "TypeMismatch":
      return `Type Mismatch: Cannot unify:
	${NF.display(error.left, ctx)}
with
	${NF.display(error.right, ctx)}`;
    case "Impossible":
      return `Impossible! ${error.message}`;
    case "MissingLabel":
      return `Missing Label: ${error.label}`;
    case "MultiplicityMismatch":
      return `Multiplicity Mismatch: Expected "${Q.display(error.expected)}" but got "${Q.display(error.right)}".`;
  }
};
export {
  Impossible,
  MissingLabel,
  MultiplicityMismatch,
  RigidVariableMismatch,
  RowMismatch,
  TypeMismatch,
  UnificationFailure,
  display
};
//# sourceMappingURL=errors.mjs.map