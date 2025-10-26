import "../../chunk-ZD7AOCMD.mjs";
import { Types } from "@yap/utils";
import * as R from "@yap/shared/rows";
import * as Lit from "@yap/shared/literals";
const tag = Symbol("Term");
const Bound = (index) => ({ type: "Bound", index });
const Free = (name) => ({ type: "Free", name });
const Meta = (val, lvl) => ({ type: "Meta", val, lvl });
let currentId = 0;
const nextId = () => ++currentId;
const mk = (ctor) => {
  const r = Types.make(tag, { ...ctor, id: nextId() });
  return r;
};
const Constructors = {
  Abs: (binding, body) => mk({ type: "Abs", binding, body }),
  Lambda: (variable, icit, body, annotation) => mk({
    type: "Abs",
    binding: { type: "Lambda", variable, icit, annotation },
    body
  }),
  Pi: (variable, icit, annotation, body) => mk({
    type: "Abs",
    binding: { type: "Pi", variable, icit, annotation },
    body
  }),
  Mu: (variable, source, annotation, body) => mk({
    type: "Abs",
    binding: { type: "Mu", variable, source, annotation },
    body
  }),
  Var: (variable) => mk({
    type: "Var",
    variable
  }),
  Vars: {
    Bound: (index) => ({ type: "Bound", index }),
    Free: (name) => ({ type: "Free", name }),
    Foreign: (name) => ({ type: "Foreign", name }),
    Label: (name) => ({ type: "Label", name }),
    Meta: (val, lvl) => ({ type: "Meta", val, lvl })
  },
  App: (icit, func, arg) => mk({
    type: "App",
    icit,
    func,
    arg
  }),
  Lit: (value) => mk({
    type: "Lit",
    value
  }),
  // Annotation: (term: Term, ann: Term): Term => ({ type: "Annotation", term, ann }),
  Row: (row) => mk({ type: "Row", row }),
  Extension: (label, value, row) => ({ type: "extension", label, value, row }),
  Struct: (row) => Constructors.App("Explicit", Constructors.Lit(Lit.Atom("Struct")), Constructors.Row(row)),
  Schema: (row) => Constructors.App("Explicit", Constructors.Lit(Lit.Atom("Schema")), Constructors.Row(row)),
  Variant: (row) => Constructors.App("Explicit", Constructors.Lit(Lit.Atom("Variant")), Constructors.Row(row)),
  Proj: (label, term) => mk({ type: "Proj", label, term }),
  Inj: (label, value, term) => mk({ type: "Inj", label, value, term }),
  Indexed: (index, term, strategy) => {
    const indexing = Constructors.App("Explicit", Constructors.Var({ type: "Foreign", name: "Indexed" }), index);
    const values = Constructors.App("Explicit", indexing, term);
    const strat = Constructors.App("Implicit", values, strategy ? strategy : Constructors.Var({ type: "Foreign", name: "defaultHashMap" }));
    return strat;
  },
  Match: (scrutinee, alternatives) => mk({ type: "Match", scrutinee, alternatives }),
  Alternative: (pattern, term, binders) => ({ pattern, term, binders }),
  Block: (statements, term) => mk({ type: "Block", statements, return: term }),
  Modal: (term, modalities) => mk({ type: "Modal", term, modalities }),
  Patterns: {
    Binder: (value) => ({ type: "Binder", value }),
    Var: (value, term) => ({ type: "Var", value, term }),
    Lit: (value) => ({ type: "Lit", value }),
    Row: (row) => ({ type: "Row", row }),
    Extension: (label, value, row) => R.Constructors.Extension(label, value, row),
    Struct: (row) => ({ type: "Struct", row }),
    Variant: (row) => ({ type: "Variant", row }),
    Wildcard: () => ({ type: "Wildcard" }),
    List: (patterns, rest) => ({ type: "List", patterns, rest })
  },
  Stmt: {
    Let: (variable, value, annotation) => ({
      type: "Let",
      variable,
      value,
      annotation
    }),
    Expr: (value) => ({ type: "Expression", value })
  }
};
const CtorPatterns = {
  Var: { type: "Var" },
  Lit: { type: "Lit" },
  Lambda: { type: "Abs", binding: { type: "Lambda" } },
  Pi: { type: "Abs", binding: { type: "Pi" } },
  Mu: { type: "Abs", binding: { type: "Mu" } },
  Match: { type: "Match" },
  Row: { type: "Row" },
  Proj: { type: "Proj" },
  Inj: { type: "Inj" },
  Annotation: { type: "Annotation" },
  Variant: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Variant" } }, arg: { type: "Row" } },
  Schema: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Schema" } }, arg: { type: "Row" } },
  Struct: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Struct" } }, arg: { type: "Row" } }
};
export {
  Bound,
  Constructors,
  CtorPatterns,
  Free,
  Meta,
  mk
};
//# sourceMappingURL=term.mjs.map