import "../../chunk-ZD7AOCMD.mjs";
import * as NF from "@yap/elaboration/normalization";
import * as EB from "@yap/elaboration";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Lit from "@yap/shared/literals";
import * as Sub from "@yap/elaboration/unification/substitution";
import { isEqual } from "lodash";
const defaultContext = () => ({
  env: [],
  implicits: [],
  sigma: {},
  trace: [],
  imports: Elaborated(),
  zonker: Sub.empty,
  ffi: PrimOps,
  metas: {}
});
const Terms = () => ({
  Type: EB.Constructors.Lit(Lit.Type()),
  Num: EB.Constructors.Lit(Lit.Atom("Num")),
  Bool: EB.Constructors.Lit(Lit.Atom("Bool")),
  String: EB.Constructors.Lit(Lit.Atom("String")),
  Unit: EB.Constructors.Lit(Lit.Atom("Unit")),
  "+": EB.Constructors.Var({ type: "Foreign", name: "$add" }),
  "-": EB.Constructors.Var({ type: "Foreign", name: "$sub" }),
  "*": EB.Constructors.Var({ type: "Foreign", name: "$mul" }),
  "/": EB.Constructors.Var({ type: "Foreign", name: "$div" }),
  "&&": EB.Constructors.Var({ type: "Foreign", name: "$and" }),
  "||": EB.Constructors.Var({ type: "Foreign", name: "$or" }),
  "==": EB.Constructors.Var({ type: "Foreign", name: "$eq" }),
  "!=": EB.Constructors.Var({ type: "Foreign", name: "$neq" }),
  "<": EB.Constructors.Var({ type: "Foreign", name: "$lt" }),
  ">": EB.Constructors.Var({ type: "Foreign", name: "$gt" }),
  "<=": EB.Constructors.Var({ type: "Foreign", name: "$lte" }),
  ">=": EB.Constructors.Var({ type: "Foreign", name: "$gte" }),
  "%": EB.Constructors.Var({ type: "Foreign", name: "$mod" }),
  "<>": EB.Constructors.Lit(Lit.Atom("<>")),
  "++": EB.Constructors.Lit(Lit.Atom("++"))
});
const NormalForms = {
  Num: () => NF.Constructors.Lit(Lit.Atom("Num")),
  Bool: () => NF.Constructors.Lit(Lit.Atom("Bool")),
  String: () => NF.Constructors.Lit(Lit.Atom("String")),
  Unit: () => NF.Constructors.Lit(Lit.Atom("Unit"))
};
const Elaborated = () => {
  const PrimTypes = {
    Num: [Terms().Num, NF.Type, []],
    Bool: [Terms().Bool, NF.Type, []],
    String: [Terms().String, NF.Type, []],
    Unit: [Terms().Unit, NF.Type, []],
    Type: [Terms().Type, NF.Type, []]
  };
  const dummyContext = {
    env: [],
    implicits: [],
    sigma: {},
    trace: [],
    imports: PrimTypes,
    zonker: Sub.empty,
    ffi: PrimOps,
    metas: {}
  };
  const reflectLiquid = (f) => {
    const i0 = EB.Constructors.Var({ type: "Bound", index: 0 });
    const i1 = EB.Constructors.Var({ type: "Bound", index: 1 });
    const i2 = EB.Constructors.Var({ type: "Bound", index: 2 });
    return EB.Constructors.Lambda("r", "Explicit", EB.DSL.eq(i0, f(i1, i2)), Terms().Num);
  };
  const mkModal = (base, liquid) => liquid ? EB.Constructors.Modal(base, { quantity: Q.Many, liquid }) : base;
  const Num_Num_Num = ([r1, r2, r3]) => NF.Constructors.Pi("x", "Explicit", NormalForms.Num(), {
    type: "Closure",
    ctx: dummyContext,
    term: EB.Constructors.Pi("y", "Explicit", mkModal(Terms().Num, r2), mkModal(Terms().Num, r3))
  });
  const Num_Num_Bool = NF.Constructors.Pi("x", "Explicit", NormalForms.Num(), {
    type: "Closure",
    ctx: dummyContext,
    term: EB.Constructors.Pi("y", "Explicit", Terms().Num, Terms().Bool)
  });
  const Bool_Bool_Bool = NF.Constructors.Pi("x", "Explicit", NormalForms.Bool(), {
    type: "Closure",
    ctx: dummyContext,
    term: EB.Constructors.Pi("y", "Explicit", Terms().Bool, Terms().Bool)
  });
  const Type_Type_Type = NF.Constructors.Pi("x", "Explicit", NF.Type, {
    type: "Closure",
    ctx: dummyContext,
    term: EB.Constructors.Pi("y", "Explicit", Terms().Type, Terms().Type)
  });
  return {
    ...PrimTypes,
    //"->": [Terms()["->"], Type_Type_Type, []],
    "+": [Terms()["+"], Num_Num_Num([, , reflectLiquid(EB.DSL.add)]), []],
    "-": [Terms()["-"], Num_Num_Num([, , reflectLiquid(EB.DSL.sub)]), []],
    "*": [Terms()["*"], Num_Num_Num([, , reflectLiquid(EB.DSL.mul)]), []],
    "/": [Terms()["/"], Num_Num_Num([, , reflectLiquid(EB.DSL.div)]), []],
    "&&": [Terms()["&&"], Bool_Bool_Bool, []],
    "||": [Terms()["||"], Bool_Bool_Bool, []],
    "==": [Terms()["=="], Num_Num_Bool, []],
    "!=": [Terms()["!="], Num_Num_Bool, []],
    "<": [Terms()["<"], Num_Num_Bool, []],
    ">": [Terms()[">"], Num_Num_Bool, []],
    "<=": [Terms()["<="], Num_Num_Bool, []],
    ">=": [Terms()[">="], Num_Num_Bool, []],
    "%": [Terms()["%"], Num_Num_Num([]), []]
  };
};
const typecheckNum = (val) => val.type === "Lit" && val.value.type === "Num";
const arithmetic = (x, y, fn) => {
  if (!typecheckNum(x)) throw new Error(`Expected number, got ${NF.display(x, { zonker: Sub.empty, metas: {}, env: [] })}`);
  if (!typecheckNum(y)) throw new Error(`Expected number, got ${NF.display(y, { zonker: Sub.empty, metas: {}, env: [] })}`);
  const val = fn(x.value.value, y.value.value);
  return NF.Constructors.Lit(Lit.Num(val));
};
const typecheckBool = (val) => val.type === "Lit" && val.value.type === "Bool";
const logical = (x, y, fn) => {
  if (!typecheckBool(x)) throw new Error(`Expected boolean, got ${NF.display(x, { zonker: Sub.empty, metas: {}, env: [] })}`);
  if (!typecheckBool(y)) throw new Error(`Expected boolean, got ${NF.display(y, { zonker: Sub.empty, metas: {}, env: [] })}`);
  const val = fn(x.value.value, y.value.value);
  return NF.Constructors.Lit(Lit.Bool(val));
};
const comparison = (x, y, fn) => {
  if (!typecheckNum(x)) throw new Error(`Expected number, got ${NF.display(x, { zonker: Sub.empty, metas: {}, env: [] })}`);
  if (!typecheckNum(y)) throw new Error(`Expected number, got ${NF.display(y, { zonker: Sub.empty, metas: {}, env: [] })}`);
  const val = fn(x.value.value, y.value.value);
  return NF.Constructors.Lit(Lit.Bool(val));
};
const FFI = {
  Indexed: (index) => (value) => (strat) => ({ index, value, strat }),
  defaultHashMap: "<Placeholder> default_hash_map",
  defaultArray: "<Placeholder> default_array",
  $add: (x) => (y) => x + y,
  $sub: (x) => (y) => x - y,
  $mul: (x) => (y) => x * y,
  $div: (x) => (y) => x / y,
  $and: (x) => (y) => x && y,
  $or: (x) => (y) => x || y,
  $eq: (x) => (y) => x == y,
  $neq: (x) => (y) => x != y,
  $lt: (x) => (y) => x < y,
  $gt: (x) => (y) => x > y,
  $lte: (x) => (y) => x <= y,
  $gte: (x) => (y) => x >= y
};
const PrimOps = {
  $add: { arity: 2, compute: (x, y) => arithmetic(x, y, (a, b) => a + b) },
  $sub: { arity: 2, compute: (x, y) => arithmetic(x, y, (a, b) => a - b) },
  $mul: { arity: 2, compute: (x, y) => arithmetic(x, y, (a, b) => a * b) },
  $div: { arity: 2, compute: (x, y) => arithmetic(x, y, (a, b) => a / b) },
  $and: { arity: 2, compute: (x, y) => logical(x, y, (a, b) => a && b) },
  $or: { arity: 2, compute: (x, y) => logical(x, y, (a, b) => a || b) },
  $eq: { arity: 2, compute: (x, y) => NF.Constructors.Lit(Lit.Bool(isEqual(x, y))) },
  $neq: { arity: 2, compute: (x, y) => NF.Constructors.Lit(Lit.Bool(!isEqual(x, y))) },
  $lt: { arity: 2, compute: (x, y) => comparison(x, y, (a, b) => a < b) },
  $gt: { arity: 2, compute: (x, y) => comparison(x, y, (a, b) => a > b) },
  $lte: { arity: 2, compute: (x, y) => comparison(x, y, (a, b) => a <= b) },
  $gte: { arity: 2, compute: (x, y) => comparison(x, y, (a, b) => a >= b) },
  $not: {
    arity: 1,
    compute: (x) => {
      if (!typecheckBool(x)) throw new Error(`Expected boolean, got ${NF.display(x, { zonker: Sub.empty, metas: {}, env: [] })}`);
      return NF.Constructors.Lit(Lit.Bool(!x.value.value));
    }
  }
};
const OP_AND = "$and";
const OP_OR = "$or";
const OP_EQ = "$eq";
const OP_NEQ = "$neq";
const OP_LT = "$lt";
const OP_GT = "$gt";
const OP_LTE = "$lte";
const OP_GTE = "$gte";
const OP_NOT = "$not";
const OP_ADD = "$add";
const OP_SUB = "$sub";
const OP_MUL = "$mul";
const OP_DIV = "$div";
const operatorMap = {
  [OP_AND]: "&&",
  [OP_OR]: "||",
  [OP_EQ]: "==",
  [OP_NEQ]: "!=",
  [OP_LT]: "<",
  [OP_GT]: ">",
  [OP_LTE]: "<=",
  [OP_GTE]: ">=",
  [OP_NOT]: "!",
  [OP_ADD]: "+",
  [OP_SUB]: "-",
  [OP_MUL]: "*",
  [OP_DIV]: "/"
};
export {
  Elaborated,
  FFI,
  NormalForms,
  OP_ADD,
  OP_AND,
  OP_DIV,
  OP_EQ,
  OP_GT,
  OP_GTE,
  OP_LT,
  OP_LTE,
  OP_MUL,
  OP_NEQ,
  OP_NOT,
  OP_OR,
  OP_SUB,
  PrimOps,
  Terms,
  defaultContext,
  operatorMap
};
//# sourceMappingURL=primitives.mjs.map