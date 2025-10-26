import "../chunk-ZD7AOCMD.mjs";
import * as R from "@yap/shared/rows";
import * as L from "@yap/shared/literals";
import * as Null from "@yap/utils";
import * as F from "fp-ts/function";
import * as NEA from "fp-ts/NonEmptyArray";
const Sourced = {
  of: (value, location) => [value, location],
  map: (f) => ([a, loc2]) => [f(a), loc2],
  located: (f) => ([a, loc2]) => ({ ...f(a), location: loc2 }),
  fold: (f) => ([a, loc2]) => f(a, loc2)
};
const Name = (tok) => F.pipe(
  tok,
  sourceLoc,
  Sourced.fold((value, location) => {
    if (typeof value !== "string") {
      throw new Error("Expected string value for var name");
    }
    return { type: "name", value, location };
  })
);
const Label = ([, tok]) => {
  return F.pipe(
    [tok],
    sourceLoc,
    Sourced.fold((value, location) => {
      if (typeof value !== "string") {
        throw new Error("Expected string value for var name");
      }
      return { type: "label", value, location };
    })
  );
};
const Str = F.flow(
  NEA.head,
  Sourced.map((value) => ({ type: "String", value }))
);
const Num = F.flow(
  NEA.head,
  Sourced.map((value) => ({ type: "Num", value }))
);
const Bool = F.flow(
  NEA.head,
  Sourced.map((value) => ({ type: "Bool", value }))
);
const Type = (tok) => [L.Type(), { from: loc(tok) }];
const Unit = (level) => (tok) => {
  const l = { from: loc(tok) };
  return level === "value" ? [L.unit(), l] : [L.Unit(), l];
};
const LitRow = (tok) => [L.Row(), { from: loc(tok) }];
const Hole = (tok) => F.pipe(
  tok,
  sourceLoc,
  Sourced.located(() => ({ type: "hole" }))
);
const Lit = ([[lit, location]]) => ({ type: "lit", value: lit, location });
const Var = ([v]) => ({ type: "var", variable: v, location: v.location });
const App = (fn, arg) => ({
  type: "application",
  fn,
  arg,
  icit: "Explicit",
  location: span(fn, arg)
});
const Application = ([fn, , arg]) => App(fn, arg);
const Operation = (data) => {
  const [lhs, , [op], , rhs] = data;
  const op_ = Var([Name([op])]);
  return App(App(op_, lhs), rhs);
};
const Annotate = (term, ann) => ({
  type: "annotation",
  term,
  ann,
  location: span(term, ann)
});
const Annotation = ([term, ...rest]) => {
  if (rest.length === 0) {
    throw new Error("Expected annotation");
  }
  const [, , , ann] = rest;
  return Annotate(term, ann);
};
const Lam = (icit, param, body) => ({
  type: "lambda",
  icit,
  variable: param.binding.value,
  annotation: param.annotation,
  body,
  location: locSpan(param.binding.location, body.location)
});
const Lambda = (icit) => ([, param, , , , body]) => {
  return Lam(icit, param, body);
};
const Pi = (icit) => ([expr, , arr, , body]) => {
  if (expr.type === "annotation") {
    const { term, ann } = expr;
    if (term.type !== "var") {
      throw new Error("Expected variable in Pi binding");
    }
    if (ann.type === "annotation") {
      throw new Error("No cumulative annotations in Pi bindings allowed");
    }
    return { type: "pi", icit, variable: term.variable.value, annotation: ann, body, location: span(expr, body) };
  }
  return { type: "arrow", lhs: expr, rhs: body, icit, location: span(expr, body) };
};
const Param = ([binding, ...ann]) => {
  if (ann.length === 0) {
    return {
      type: "param",
      binding
    };
  }
  const [, , , term] = ann;
  return {
    type: "param",
    binding,
    annotation: term
  };
};
const keyval = (pair) => {
  const [v, , , , value] = pair;
  return Sourced.of([v.value, value], locSpan(v.location, value.location));
};
const emptyRow = ([location]) => ({ type: "row", location, row: { ...R.Constructors.Empty(), location } });
const row = ([[pairs, v]]) => {
  if (pairs.length === 0) {
    throw new Error("Expected at least one key-value pair in row");
  }
  const last = pairs[pairs.length - 1];
  const tail = !v ? { type: "empty", location: last[1] } : { type: "variable", variable: v, location: v.location };
  const row2 = pairs.reduceRight((r, [[label, value], loc2]) => ({ type: "extension", label, value, row: r, location: loc2 }), tail);
  return { type: "row", row: row2, location: locSpan(pairs[0][1], tail.location) };
};
const emptyStruct = ([location]) => ({ type: "struct", location, row: { ...R.Constructors.Empty(), location } });
const struct = ([[pairs, v]]) => {
  if (pairs.length === 0) {
    throw new Error("Expected at least one key-value pair in struct");
  }
  const last = pairs[pairs.length - 1];
  const tail = v ? { type: "variable", variable: v, location: v.location } : { type: "empty", location: last[1] };
  const row2 = pairs.reduceRight((acc, [[label, value], location]) => ({ type: "extension", label, value, row: acc, location }), tail);
  return { type: "struct", row: row2, location: locSpan(pairs[0][1], tail.location) };
};
const dict = ([data]) => {
  const [, [, index], , , , term] = data;
  return { type: "dict", index, term, location: locSpan(index.location, term.location) };
};
const tagged = ([tok, v, , tm]) => {
  return {
    type: "tagged",
    tag: v.value,
    term: tm,
    location: locSpan({ from: loc(tok) }, tm.location)
  };
};
const variant = (data) => {
  const mkVariant = (terms) => {
    const last = terms[terms.length - 1];
    const tail = { type: "empty", location: last.location };
    const row2 = terms.reduceRight((acc, tm) => {
      return { type: "extension", label: tm.tag, value: tm.term, row: acc, location: tm.location };
    }, tail);
    return { type: "variant", row: row2, location: locSpan(terms[0].location, tail.location) };
  };
  if (data.length === 1) {
    return mkVariant(data[0]);
  }
  return mkVariant(data[1]);
};
const tuple = ([[terms, v]]) => {
  if (terms.length === 0) {
    throw new Error("Expected at least one term in tuple");
  }
  const last = terms[terms.length - 1];
  const tail = v ? { type: "variable", variable: v, location: v.location } : { type: "empty", location: last.location };
  return {
    type: "tuple",
    row: terms.reduceRight((row2, value, i) => ({ type: "extension", label: i.toString(), value, row: row2, location: value.location }), tail),
    location: locSpan(terms[0].location, last.location)
  };
};
const emptyList = ([location]) => ({ type: "list", elements: [], location });
const list = ([[terms, v]]) => {
  if (terms.length === 0) {
    throw new Error("Expected at least one term in list");
  }
  const last = terms[terms.length - 1];
  return {
    type: "list",
    elements: terms,
    rest: v,
    location: locSpan(terms[0].location, last.location)
  };
};
const Projection = (input) => {
  const project = (label2, term2) => ({ type: "projection", label: label2.value, term: term2, location: locSpan(label2.location, term2.location) });
  if (input.length === 2) {
    const [tok, label2] = input;
    const binding = { type: "name", value: "x", location: { from: loc(tok) } };
    return Lam("Explicit", { type: "param", binding }, project(label2, Var([binding])));
  }
  const [term, , label] = input;
  return project(label, term);
};
const Injection = ([inj]) => {
  const inject = ([[label, value], loc2], term2) => ({
    type: "injection",
    label,
    value,
    term: term2,
    location: locSpan(loc2, term2.location)
  });
  if (inj.length === 3) {
    const [, tok, pairs2] = inj;
    const binding = { type: "name", value: "x", location: { from: loc(tok) } };
    const body = pairs2.reduce((tm, kv) => inject(kv, tm), Var([binding]));
    return Lam("Explicit", { type: "param", binding }, body);
  }
  const [, term, , , pairs] = inj;
  return pairs.reduce((tm, kv) => inject(kv, tm), term);
};
const Match = ([tok, , term, alts]) => {
  if (alts.length === 0) {
    throw new Error("Expected at least one alternative in pattern match");
  }
  return {
    type: "match",
    scrutinee: term,
    alternatives: alts,
    location: locSpan({ from: loc(tok) }, alts[alts.length - 1].location)
  };
};
const Alternative = (alt) => {
  const bar = alt[1];
  const pat = alt[3];
  const term = alt[7];
  return {
    pattern: pat,
    term,
    location: locSpan({ from: loc(bar) }, term.location)
  };
};
const keyvalPat = (pair) => {
  const [v, , , , pat] = pair;
  return [v.value, pat];
};
const taggedPat = ([tok, v, , pat]) => {
  return [v.value, pat];
};
const Pattern = {
  Var: ([value]) => ({ type: "var", value }),
  Lit: ([[value]]) => ({ type: "lit", value }),
  Tuple: ([[terms, v]]) => {
    const tail = !v ? { type: "empty" } : { type: "variable", variable: v };
    const row2 = terms.reduceRight((row3, value, i) => ({ type: "extension", label: i.toString(), value, row: row3 }), tail);
    return { type: "tuple", row: row2 };
  },
  Struct: ([[pairs, v]]) => {
    const tail = !v ? { type: "empty" } : { type: "variable", variable: v };
    const row2 = pairs.reduceRight((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), tail);
    return { type: "struct", row: row2 };
  },
  List: ([[elements, v]]) => {
    return { type: "list", elements, rest: v };
  },
  Row: ([[pairs, v]]) => {
    const tail = !v ? { type: "empty" } : { type: "variable", variable: v };
    const row2 = pairs.reduceRight((acc, [label, value]) => ({ type: "extension", label, value, row: acc }), tail);
    return { type: "row", row: row2 };
  },
  Variant: ([pats, last]) => {
    const tail = { type: "extension", label: last[0], value: last[1], row: { type: "empty" } };
    const row2 = pats.reduceRight((acc, [[label, value]]) => ({ type: "extension", label, value, row: acc }), tail);
    return { type: "variant", row: row2 };
  },
  Wildcard: ([tok]) => ({ type: "wildcard" }),
  Empty: {
    List: () => ({ type: "list", elements: [] }),
    Struct: () => ({ type: "struct", row: { type: "empty" } })
  }
};
const Block = ([input]) => {
  const block = (statements, ret2) => {
    if (statements.length === 0 && !ret2) {
      throw new Error("Expected at least one statement in block");
    }
    const first = statements[0] || ret2;
    const location = locSpan(first.location, ret2?.location || statements[statements.length - 1].location);
    return { type: "block", statements, return: ret2, location };
  };
  if (Array.isArray(input[0])) {
    const [statements, , ret2] = input;
    return block(statements, ret2 || void 0);
  }
  const [ret] = input;
  return block([], ret);
};
const Return = (d) => d[3];
const Expr = ([value]) => ({ type: "expression", value, location: value.location });
const Using = (data) => {
  if (data.length !== 3) {
    throw new Error("Expected 4 elements in using statement. Renaming not yet implemented");
  }
  const [, , term] = data;
  return { type: "using", value: term, location: term.location };
};
const Foreign = (data) => {
  const [, , variable, , , , term] = data;
  return { type: "foreign", variable: variable.value, annotation: term, location: locSpan(variable.location, term.location) };
};
const LetDec = ([, , variable, ...rest]) => {
  const letdec = (variable2, value2, annotation, multiplicity) => ({
    type: "let",
    variable: variable2.value,
    value: value2,
    annotation,
    multiplicity,
    location: locSpan(variable2.location, value2.location)
  });
  if (rest.length === 4) {
    const [, , , value2] = rest;
    return letdec(variable, value2);
  }
  if (rest.length === 8) {
    const [, , , ann2, , , , value2] = rest;
    return letdec(variable, value2, ann2);
  }
  const q = rest[3][0];
  const ann = rest[5];
  const value = rest[9];
  return letdec(variable, value, ann, q);
};
const Modal = (data) => {
  if (data.length === 7) {
    const [[q], , term2, , , liquid2] = data;
    return { type: "modal", term: term2, modalities: { quantity: q, liquid: liquid2 }, location: term2.location };
  }
  if (Array.isArray(data[0])) {
    const [[q], , term2] = data;
    return { type: "modal", term: term2, modalities: { quantity: q }, location: term2.location };
  }
  const [term, , [liquid]] = data;
  return { type: "modal", term, modalities: { liquid }, location: locSpan(term.location, liquid.location) };
};
const script = ([statements]) => {
  return { type: "script", script: statements };
};
const module_ = ([, exports, imports, , script2]) => {
  return { type: "module", imports, exports, content: script2 };
};
const exportSome = ([, , variables]) => {
  return { type: "explicit", names: variables.map((v) => v.value) };
};
const exportAll = () => {
  return { type: "*" };
};
const importAll = ([, , , str]) => {
  return { type: "*", filepath: str[0], hiding: [] };
};
const importSome = ([
  ,
  ,
  ,
  str,
  ,
  vars
]) => {
  return { type: "explicit", filepath: str[0], names: vars.map((v) => v.value) };
};
const empty = (toks) => {
  const start = toks[0];
  const end = toks[toks.length - 1];
  return range(start, end);
};
const unwrap = (arg) => {
  const [l, [t], , r] = arg;
  return [t, range(l, r)];
};
const many = (arg) => {
  const [arr, , t2] = arg;
  const t1 = arr.flatMap(([, t]) => t);
  return t1.concat(t2);
};
const enclosed = ([[t]]) => t;
const extract = ([[t]]) => t;
const sourceLoc = ([tok]) => [tok.value, { from: loc(tok) }];
const loc = (tok) => ({
  line: tok.line,
  column: tok.col,
  token: tok
});
const range = (from, to) => ({
  from: loc(from),
  to: Null.map(to, loc)
});
const span = (t1, t2) => ({
  from: t1.location.from,
  to: t2.location.to || t2.location.from
});
const locSpan = (from, to) => ({
  from: from.from,
  to: to?.to || to?.from
});
export {
  Alternative,
  Annotation,
  Application,
  Block,
  Bool,
  Expr,
  Foreign,
  Hole,
  Injection,
  Label,
  Lambda,
  LetDec,
  Lit,
  LitRow,
  Match,
  Modal,
  Name,
  Num,
  Operation,
  Param,
  Pattern,
  Pi,
  Projection,
  Return,
  Str,
  Type,
  Unit,
  Using,
  Var,
  dict,
  empty,
  emptyList,
  emptyRow,
  emptyStruct,
  enclosed,
  exportAll,
  exportSome,
  extract,
  importAll,
  importSome,
  keyval,
  keyvalPat,
  list,
  many,
  module_,
  row,
  script,
  sourceLoc,
  struct,
  tagged,
  taggedPat,
  tuple,
  unwrap,
  variant
};
//# sourceMappingURL=processors.mjs.map