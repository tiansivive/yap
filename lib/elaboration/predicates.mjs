import "../chunk-ZD7AOCMD.mjs";
function isLambda(term) {
  return term.type === "lambda";
}
function isImplicitPiAbs(val) {
  return val.type === "Abs" && val.binder.type === "Pi" && val.binder.icit === "Implicit";
}
export {
  isImplicitPiAbs,
  isLambda
};
//# sourceMappingURL=predicates.mjs.map