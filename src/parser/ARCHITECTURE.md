# Parser Architecture

The parser module provides two coexisting backends — **Nearley** (v1, active) and **tree-sitter** (v2, migration target) — and defines the **source AST** (`Src.Term`) that feeds into elaboration.

## Module Map

```
src/parser/
├── grammar.ne          # Nearley grammar source
├── grammar.ts          # Generated (nearleyc output, @ts-nocheck)
├── processors.ts       # Nearley postprocessors → Src.Term builders
├── terms.ts            # Src.Term type definition (AST)
├── pretty.ts           # Src.Term → string display
├── utils.ts            # CST navigation utilities (tree-sitter v2)
├── index.ts            # Barrel re-exports
├── types/
│   └── generated.d.ts  # Tree-sitter node types (@asgerf/dts-tree-sitter)
└── __tests__/          # 13 test files + snapshots
```

## Dual-Backend Design

| Aspect | Nearley (v1) | Tree-sitter (v2) |
|--------|-------------|-------------------|
| Grammar source | `grammar.ne` | `tree-sitter-yap/grammar.js` (external) |
| Output | `Src.Term` (AST) | `CST.SyntaxNode` (CST) |
| Regenerate | `pnpm run nearley` | `pnpm ts-dts` (types only) |
| Elaboration consumer | `src/elaboration/elaborate.ts` | `src/elaboration/inference.v2/` |

Both backends coexist during the v2 migration. The Nearley path is used by the active compiler pipeline; tree-sitter types and utilities are consumed by v2 elaboration modules.

## Grammar Precedence Hierarchy

The Nearley grammar (`grammar.ne`) uses a **Moo lexer** and defines precedence via nonterminal chaining (lowest → highest):

| Precedence | Nonterminal | Description |
|------------|-------------|-------------|
| Lowest | `Ann` | Type annotation `expr : TypeExpr` |
| | `TypeExpr` | `Pi` or `ModalType` |
| | `ModalType` | Quantity-annotated types (`<1> T`), liquid refinements (`T [|pred|]`) |
| | `Type` | `Mu` / `Variant` / `Dict` / `Row` / `Expr` |
| | `Expr` | `Lambda` / `Match` / `Block` / `Reset` / `Shift` / `Resume` / `Op` |
| | `Op` | Binary operations — left-recursive over `App` |
| | `App` | Application (space = explicit, `@` = implicit) — left-recursive over `Atom` |
| Highest | `Atom` | Identifiers, holes, literals, structs, tuples, projections, injections, lists |

**Top-level:** `Module` → `Exports` + `Imports` + `Script` (list of `Statement`s separated by `;`).

**Key structural rules:**
- **Pi/Arrow**: `ModalType -> Type` (explicit) / `ModalType => Type` (implicit). Annotation LHS `(x : A)` → `pi`; otherwise `arrow`.
- **Lambda**: `\params -> body` / `\params => body`. Multi-param lambdas desugared into nested single-param via `reduceRight`.
- **Block**: `{ stmts; return expr; }` with `let`, `using`, `foreign`, expressions.
- **Match**: `match expr | pat -> body ...`
- **Mu**: `μ X -> TypeExpr` (iso-recursive types).

**Macros:** `Parens[X]`, `Curly[X]`, `Square[X]`, `Angle[X]`, `DoubleBracket[X]`, `Many[X, Sep]`, and others.

## Processors (`processors.ts`)

Nearley postprocessors transform matched token arrays into `Src.Term` nodes. Key patterns:

- **Location threading**: Every node carries `location: P.Location` (line/col from Moo tokens). Helpers: `sourceLoc`, `loc`, `range`, `span`, `locSpan`.
- **`Sourced<T>`**: `[value, Location]` pair — intermediate representation before final AST construction.
- **Row folding**: Struct, tuple, row, variant, dict, list — all build from `KeyVal` pairs using `reduceRight` to construct right-folded `R.Row` chains (extension → ... → empty/variable tail).
- **Lambda desugaring**: `Lambda(icit)` unpacks params, then `Lam` does `reduceRight` to nest single-param lambdas.
- **Operator desugaring**: `a + b` → `App(App(op, a), b)` — operators are regular vars.
- **Point-free projections/injections**: `Projection` on a bare label creates `\x -> x.label`.

## `Src.Term` — Source AST (`terms.ts`)

`Term = WithLocation<Bare>` — every term carries a `location`.

**`Bare` discriminated union (20 variants):**

| `type` | Key fields | Notes |
|--------|-----------|-------|
| `lit` | `value: Literal` | Numbers, strings, bools, Type, Unit, Row |
| `var` | `variable: Variable` | Named or labeled |
| `hole` | — | Inference placeholder `_` |
| `arrow` | `lhs, rhs, icit` | Non-dependent function type |
| `lambda` | `variable, annotation?, body, icit` | Lambda abstraction |
| `pi` | `variable, annotation, body, icit` | Dependent function type |
| `application` | `fn, arg, icit` | Function application |
| `annotation` | `term, ann` | Type annotation |
| `list` | `elements, rest?` | List literal with optional tail |
| `tuple` | `row: Row` | Positional row |
| `struct` | `row, tail?` | Record/struct |
| `dict` | `index, term` | Indexed/dictionary type |
| `tagged` | `tag, term` | Variant constructor |
| `variant` | `row: Row` | Variant type |
| `row` | `row: Row` | Row type |
| `injection` | `label, value, term` | Record update |
| `projection` | `label, term` | Field projection |
| `match` | `scrutinee, alternatives` | Pattern match |
| `block` | `statements, return?` | Block expression |
| `modal` | `term, modalities` | QTT/liquid modality |
| `reset` / `shift` / `resume` | `term` | Delimited continuations |

**Supporting types:**
- `Variable = WithLocation<{ type: "name" | "label"; value: string }>`
- `Row = WithLocation<R.Row<Term, Variable>>` — right-folded (extension/empty/variable)
- `Pattern` — 8 variants (var, lit, row, struct, variant, tuple, list, wildcard)
- `Statement` — 4 variants (expression, let, using, foreign)
- `Module`, `Script`, `Import`, `Export` — top-level declarations

## CST Types and Utilities (Tree-sitter v2)

### `types/generated.d.ts`

Auto-generated from the tree-sitter grammar via `@asgerf/dts-tree-sitter`. Provides:

- **`SyntaxType` const enum** — ~60 members mapping node type strings (e.g. `SyntaxType.Lambda`, `SyntaxType.Elam`, `SyntaxType.Application`).
- **Supertype unions** — `AtomNode`, `ExprNode`, `PatternNode`, `StatementNode`, `TypeExprNode` mirror the grammar hierarchy.
- **Per-node interfaces** — Typed field accessors for each node type.

Notable differences from Nearley AST:
- Lambda uses separate `Elam`/`Ilam` (explicit/implicit body) nodes.
- Application uses `Argument` nodes with XOR `explicitNode`/`implicitNode` fields.
- Spine-style `Application` (function + argument list) rather than nested binary apps.

### `utils.ts` — CST Navigation

Utilities for v2 elaboration's CST traversal:

- **`extractFields(node, ...fieldNames)`** — Type-safe field extraction using `YapFieldMap`. Supports repeatable fields via `[fieldName]` tuple syntax.
- **`requireField(node, name)`** — Single/repeatable field lookup with existence checks.
- **`extractParam(node: ParamNode)`** — Extracts `{ name, annotation }` from param nodes, handling bare and annotated cases.

## Barrel Exports (`index.ts`)

```typescript
export * from "./terms";           // Src.Term, Statement, Variable, etc.
export * from "./pretty";          // display()
export * as Processors from "./processors";
export * as Types from "./types/generated";  // SyntaxType, node interfaces
export * as Utils from "./utils";            // CST utilities
```

Both Nearley AST types and tree-sitter CST types are surfaced through a single barrel, supporting dual-parser coexistence.

## Test Patterns

13 test files under `__tests__/`: blocks, functions, grammar, indexed, literals, pattern_matching, precedence, primops, refinements, rows, shift-reset, usages, variables.

```typescript
const mkParser = (start = "Ann") => {
  const g = { ...Grammar, ParserStart: start } as typeof Grammar;
  return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

it("number: 1", () => {
  const data = parser.feed("1");
  expect(data.results.length).toBe(1);  // ambiguity guard
  expect(data.results[0]).toMatchSnapshot();
});
```

- `ParserStart` overridden per test (usually `"Ann"` for expressions).
- `results.length === 1` asserts unambiguous parse.
- Output validated via **Vitest snapshots**, not string equality.
