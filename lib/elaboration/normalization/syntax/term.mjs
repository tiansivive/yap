import "../../../chunk-ZD7AOCMD.mjs";
import * as Lit from "@yap/shared/literals";
import { Types } from "@yap/utils";
const nf_tag = Symbol("NF");
let currentId = 0;
const nextId = () => ++currentId;
const mk = (val) => {
  return { ...Types.make(nf_tag, val), id: nextId() };
};
const Constructors = {
  Var: (variable) => mk({ type: "Var", variable }),
  Pi: (variable, icit, annotation, closure) => mk({
    type: "Abs",
    binder: { type: "Pi", variable, icit, annotation },
    closure
  }),
  Mu: (variable, source, annotation, closure) => mk({
    type: "Abs",
    binder: { type: "Mu", variable, annotation, source },
    closure
  }),
  Lambda: (variable, icit, closure, annotation) => mk({
    type: "Abs",
    binder: { type: "Lambda", variable, icit, annotation },
    closure
  }),
  Rigid: (lvl) => mk({
    type: "Neutral",
    value: Constructors.Var({ type: "Bound", lvl })
  }),
  Flex: (variable) => mk({
    type: "Neutral",
    value: Constructors.Var(variable)
  }),
  Lit: (value) => mk({
    type: "Lit",
    value
  }),
  Atom: (value) => mk(Constructors.Lit(Lit.Atom(value))),
  Neutral: (value) => mk({
    type: "Neutral",
    value
  }),
  App: (func, arg, icit) => mk({
    type: "App",
    func,
    arg,
    icit
  }),
  Closure: (ctx, term) => ({ type: "Closure", ctx, term }),
  Primop: (ctx, term, arity, compute) => ({ type: "PrimOp", ctx, term, arity, compute }),
  Row: (row) => mk({ type: "Row", row }),
  Extension: (label, value, row) => ({ type: "extension", label, value, row }),
  Schema: (row) => Constructors.Neutral(Constructors.App(Constructors.Lit(Lit.Atom("Schema")), Constructors.Row(row), "Explicit")),
  Variant: (row) => Constructors.Neutral(Constructors.App(Constructors.Lit(Lit.Atom("Variant")), Constructors.Row(row), "Explicit")),
  Modal: (value, modalities) => mk({
    type: "Modal",
    value,
    modalities
  }),
  External: (name, arity, compute, args) => mk({ type: "External", name, arity, compute, args })
};
const Type = mk({
  type: "Lit",
  value: { type: "Atom", value: "Type" }
});
const Row = mk({
  type: "Lit",
  value: { type: "Atom", value: "Row" }
});
const Indexed = mk({
  type: "Var",
  variable: { type: "Foreign", name: "Indexed" }
});
const Any = mk({
  type: "Lit",
  value: { type: "Atom", value: "Any" }
});
const Patterns = {
  Var: { type: "Var" },
  Rigid: { type: "Var", variable: { type: "Bound" } },
  Flex: { type: "Var", variable: { type: "Meta" } },
  Free: { type: "Var", variable: { type: "Free" } },
  Label: { type: "Var", variable: { type: "Label" } },
  Lit: { type: "Lit" },
  Atom: { type: "Lit", value: { type: "Atom" } },
  Type: { type: "Lit", value: { type: "Atom", value: "Type" } },
  Unit: { type: "Lit", value: { type: "Atom", value: "Unit" } },
  Variant: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Variant" } }, arg: { type: "Row" } },
  Schema: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Schema" } }, arg: { type: "Row" } },
  Struct: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Struct" } }, arg: { type: "Row" } },
  App: { type: "App" },
  Pi: { type: "Abs", binder: { type: "Pi" } },
  Lambda: { type: "Abs", binder: { type: "Lambda" } },
  Mu: { type: "Abs", binder: { type: "Mu" } },
  Row: { type: "Row" },
  Modal: { type: "Modal" },
  Recursive: {
    type: "App",
    func: {
      type: "Abs",
      binder: { type: "Mu" }
    }
  },
  Indexed: {
    type: "App",
    icit: "Implicit",
    func: {
      type: "App",
      func: {
        type: "App",
        func: {
          type: "Var",
          variable: { type: "Foreign", name: "Indexed" }
        }
      }
    }
  },
  HashMap: {
    type: "Neutral",
    value: {
      type: "App",
      icit: "Implicit",
      func: {
        type: "App",
        func: {
          type: "App",
          func: {
            type: "Var",
            variable: { type: "Foreign", name: "Indexed" }
          },
          arg: { type: "Lit", value: { type: "Atom", value: "String" } }
        }
      }
    }
  },
  Array: {
    type: "App",
    func: {
      type: "App",
      func: { type: "Lit", value: { type: "Atom", value: "Indexed" } },
      arg: { type: "Lit", value: { type: "Atom", value: "Num" } }
    }
  }
};
export {
  Any,
  Constructors,
  Indexed,
  Patterns,
  Row,
  Type,
  mk,
  nf_tag
};
//# sourceMappingURL=term.mjs.map