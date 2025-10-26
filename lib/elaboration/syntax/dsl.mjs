import "../../chunk-ZD7AOCMD.mjs";
import * as EB from "@yap/elaboration";
import { OP_AND, OP_EQ, OP_NOT, OP_OR } from "@yap/shared/lib/primitives";
const and = (p, q) => {
  const _and = EB.Constructors.Var({ type: "Foreign", name: OP_AND });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _and, p), q);
  return app;
};
const or = (p, q) => {
  const _or = EB.Constructors.Var({ type: "Foreign", name: OP_OR });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _or, p), q);
  return app;
};
const not = (p) => {
  const _not = EB.Constructors.Var({ type: "Foreign", name: OP_NOT });
  const app = EB.Constructors.App("Explicit", _not, p);
  return app;
};
const eq = (p, q) => {
  const _eq = EB.Constructors.Var({ type: "Foreign", name: OP_EQ });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _eq, p), q);
  return app;
};
const neq = (p, q) => {
  const _neq = EB.Constructors.Var({ type: "Foreign", name: "$neq" });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _neq, p), q);
  return app;
};
const add = (p, q) => {
  const _add = EB.Constructors.Var({ type: "Foreign", name: "$add" });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _add, p), q);
  return app;
};
const sub = (p, q) => {
  const _sub = EB.Constructors.Var({ type: "Foreign", name: "$sub" });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _sub, p), q);
  return app;
};
const mul = (p, q) => {
  const _mul = EB.Constructors.Var({ type: "Foreign", name: "$mul" });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _mul, p), q);
  return app;
};
const div = (p, q) => {
  const _div = EB.Constructors.Var({ type: "Foreign", name: "$div" });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _div, p), q);
  return app;
};
const gt = (p, q) => {
  const _gt = EB.Constructors.Var({ type: "Foreign", name: "$gt" });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _gt, p), q);
  return app;
};
const lt = (p, q) => {
  const _lt = EB.Constructors.Var({ type: "Foreign", name: "$lt" });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _lt, p), q);
  return app;
};
const gte = (p, q) => {
  const _gte = EB.Constructors.Var({ type: "Foreign", name: "$gte" });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _gte, p), q);
  return app;
};
const lte = (p, q) => {
  const _lte = EB.Constructors.Var({ type: "Foreign", name: "$lte" });
  const app = EB.Constructors.App("Explicit", EB.Constructors.App("Explicit", _lte, p), q);
  return app;
};
export {
  add,
  and,
  div,
  eq,
  gt,
  gte,
  lt,
  lte,
  mul,
  neq,
  not,
  or,
  sub
};
//# sourceMappingURL=dsl.mjs.map