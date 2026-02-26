# Yap — Architecture Overview

> A small dependently typed language with structural types, implicits, and code verification semantics via modalities (QTT-based multiplicities and liquid type refinements).

---

## Compiler Pipeline

```
  Source (.yap)
       │
       ▼
  ┌─────────┐     Nearley (v1) ──► Src.Term (AST)
  │  Parse   │
  └─────────┘     tree-sitter (v2, migration) ──► CST.SyntaxNode
       │
       ▼
  ┌─────────────┐
  │  Elaborate   │  Bidirectional inference + NbE
  └─────────────┘  Emits constraints ──► Solver ──► Substitution
       │
       │  EB.Term + NF.Value
       ▼
  ┌─────────────┐
  │   Verify     │  Liquid refinement subtyping ──► SMT / Z3
  └─────────────┘  Multiplicity checking (planned)
       │
       ▼
  ┌─────────────┐
  │   Codegen    │  EB.Term ──► JavaScript (CommonJS)
  └─────────────┘
       │
       ▼
    Output (.js)
```

### Orchestration

The pipeline is orchestrated by two entry points:

- **`src/compile.ts`** — File compilation. Calls `modules/loading.ts` → `mkInterface` which recursively parses, resolves imports, elaborates, and registers modules in a global module table. Then iterates over all loaded modules to generate JS and copy FFI files.
- **`scripts/cli.ts`** — CLI. Uses Commander to dispatch either a file compilation (`compile`) or an interactive session (`repl`). Initialises Z3 context before use.

Verification is **not** invoked automatically during `compile`. It runs on demand (from the REPL or via explicit CLI invocation) after the Z3 solver context is initialised.

---

## Module Map

```
src/
├── compile.ts                  Pipeline orchestration
├── cli/repl.ts                 Interactive REPL (readline, vm)
│
├── parser/                     Parsing (Nearley v1 + tree-sitter v2)
│   ├── ARCHITECTURE.md
│   └── ...
│
├── elaboration/                Bidirectional type inference + NbE
│   ├── ARCHITECTURE.md
│   ├── normalization/          NbE engine (evaluate, quote, generalize)
│   │   ├── ARCHITECTURE.md
│   │   └── ...
│   └── ...
│
├── verification/               Liquid refinements, modality verification
│   ├── ARCHITECTURE.md
│   └── ...
│
├── modules/loading.ts          Module resolution, import handling
├── Codegen/                    JavaScript code generation
├── FFI/codecs.ts               Foreign function interface codec
├── lowering/                   MIR lowering (EB.Term → LIR); see docs/MIR-LOWERING.md for design and status
├── shared/                     Cross-cutting types, primitives, config
└── utils/                      Generic helpers (types, objects, functions)
```

Modules marked with `ARCHITECTURE.md` have their own detailed architecture documents. See the links in [Per-module documentation](#per-module-documentation) below.

---

## Key Data Types

These are the core representations that flow through the pipeline. Understanding them is essential.

### `Src.Term` — Surface AST

**Defined in:** `src/parser/terms.ts`

The parse output from the Nearley grammar. A `Term` is `WithLocation<Bare>` where `Bare` is a discriminated union of surface syntax forms:

`lit` · `var` · `hole` · `arrow` · `lambda` · `pi` · `application` · `annotation` · `list` · `tuple` · `struct` · `dict` · `tagged` · `variant` · `row` · `injection` · `projection` · `match` · `block` · `modal` · `reset` · `shift` · `resume`

Also defines `Statement` (`expression | let | using | foreign`), `Pattern`, `Module`, `Import`, `Export`.

### `CST.SyntaxNode` — Concrete Syntax Tree (v2)

**Defined in:** `src/parser/types/generated.d.ts` (generated from tree-sitter grammar)

The tree-sitter parse output. Typed node types with field access, used by `inference.v2/` and `checking.v2/` modules. See `src/parser/utils.ts` for `extractFields`, `extractParam`, and the `SyntaxType` enum.

### `EB.Term` — Elaborated Core Term

**Defined in:** `src/elaboration/syntax/term.ts`

The output of elaboration. A branded type (`Types.Brand<symbol, Constructor & { id }>`) with core term forms:

| Constructor       | Description                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `Lit`             | Literal values                                                                                |
| `Var`             | Variables: `Bound` (de Bruijn index), `Free`, `Foreign`, `Label`, `Meta` (with val + lvl)     |
| `Abs`             | Abstraction with `Binding`: `Let`, `Lambda`, `Mu`, `Pi`, `Sigma` — each carries an annotation |
| `App`             | Application with icit                                                                         |
| `Row`             | Row types (struct, variant, array, schema fields)                                             |
| `Proj`            | Record projection                                                                             |
| `Inj`             | Variant injection                                                                             |
| `Match`           | Pattern matching with alternatives                                                            |
| `Block`           | Statement sequences with return                                                               |
| `Modal`           | Modality annotations (refinements, multiplicities)                                            |
| `Reset` / `Shift` | Delimited continuations                                                                       |

Structural types are encoded via smart constructors: e.g., `Struct(row)` → `App(Lit(Atom("Struct")), Row(row))`.

### `NF.Value` — Normal Forms (Semantic Domain)

**Defined in:** `src/elaboration/normalization/syntax/term.ts`

The semantic domain used by Normalisation by Evaluation (NbE). Also a branded type. Key differences from `EB.Term`:

- Variables use **de Bruijn levels** (not indices) — `Bound { lvl }` instead of `Bound { index }`.
- **Closures** capture an environment and an unevaluated `EB.Term`, enabling lazy evaluation.
- **Externals** represent primitive operations with an arity and a compute function (`(...args: Value[]) => Value`).
- **Neutral** terms represent stuck computations (e.g., application to a variable).

Binders: `Pi`, `Lambda`, `Mu`, `Sigma` — each with an annotation that is already a `Value`.

Closures are one of: `Closure` (ctx + unevaluated `EB.Term`), `PrimOp` (arity + compute), `Continuation` (stack frames + results).

### `Context` — Elaboration Context

**Defined in:** `src/elaboration/shared/context.ts`

The environment threaded through elaboration (via the reader component of the monad):

| Field       | Type                                 | Purpose                                                                           |
| ----------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| `env`       | `Array<{ type, nf, name }>`          | Binding stack — each entry has the binder, its origin, its NF type, and the value |
| `implicits` | `Array<[EB.Term, NF.Value]>`         | Implicit arguments in scope                                                       |
| `sigma`     | `Record<string, Sigma>`              | Dependent record field context (term, nf, annotation, multiplicity)               |
| `zonker`    | `Sub.Subst`                          | Meta substitution — avoids eager substitution                                     |
| `metas`     | `Record<number, { meta, ann }>`      | All generated meta-variables with their annotations                               |
| `imports`   | `Record<string, EB.AST>`             | Imported / free variable bindings                                                 |
| `ffi`       | `Record<string, { arity, compute }>` | Primitive / foreign function implementations                                      |
| `trace`     | `P.Stack<Provenance>`                | Source provenance tracking                                                        |

Variable lookup resolves through: labels via `sigma`, bound vars via `env` scan, free vars via `imports`.

---

## Cross-cutting Concerns

### Elaboration Monad

**Defined in:** `src/elaboration/shared/monad.v2.ts`

`Elaboration<A>` is a generator-based reader-writer-state-either monad:

```
(ctx: Context, w?: Collector, st?: MutState) => [Collector<A>, MutState]
```

- **Reader**: `Context` (ask / local)
- **Writer**: Constraints, binders, metas, zonker, types (tell / listen)
- **State**: Delimitations (shift/reset), skolems, nondeterminism (getSt / modifySt)
- **Either**: `Either<Err, A>` — short-circuit on error

`V2.Do(function*() { ... })` provides Do-notation via generators — `yield*` sequences monadic operations imperatively.

Despite the `.v2` filename, this is the **active monad** used throughout the v1 codebase. The label is historical.

### Meta Variables

Meta-variables are placeholders for unknown types or terms, generated with `freshMeta(lvl, annotation)`. They participate in:

1. **Generation**: During inference, when a type is unknown (e.g., unannotated lambda parameter)
2. **Constraint emission**: Unification constraints are emitted and collected via the writer
3. **Solving**: The constraint solver unifies metas with concrete types, producing a `Subst` (substitution)
4. **Zonking**: The substitution is applied lazily via the `zonker` field in `Context`, rather than eagerly traversing all terms

### Constraint Flow

1. Inference/checking **emit** unification constraints via `tell("constraint", ...)`
2. Constraints are **collected** via `listen()` at let-binding boundaries (in `statements.ts`)
3. The **solver** (`solver/solver.ts`) processes constraints via first-order unification
4. Solutions produce a **substitution** (`zonker`) that maps metas to their resolved values
5. The substitution is threaded forward, applied lazily during subsequent normalisation

### Primitives and Built-ins

**Defined in:** `src/shared/lib/primitives.ts`, `src/shared/lib/constants.ts`

A small set of primitive types (`Num`, `Bool`, `String`, `Unit`) and operators (`+`, `-`, `*`, `/`, `&&`, `||`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `%`, `<>`, `++`, `not`).

Each primitive operator has:

- An elaborated type (with liquid refinements, e.g., `+` carries `\r -> r == x + y`)
- A NF value representation
- A runtime compute function (for NbE evaluation)

`defaultContext()` assembles these into the initial `Context` used by the elaborator.

### Module System

**Defined in:** `src/modules/loading.ts`

`mkInterface(moduleName, visited, opts)`:

- Memoises into `globalModules` to avoid re-loading
- Detects circular dependencies via `visited` list
- Parses `.yap` files via Nearley into `Src.Module`
- Recursively resolves imports with cycle tracking
- Builds a local context extending `defaultContext` with resolved imports
- Elaborates the module via `EB.Mod.elaborate`
- Returns an `Interface`: `{ imports, exports, foreign, letdecs, errors }`

Import modes: `*` (with hiding), explicit, qualified (with alias prefix).

---

## Entry Points

| Entry Point          | Command               | Description                                                                                        |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| File compilation     | `pnpm yap <file>.yap` | Parse → elaborate → codegen. Outputs JS to `./bin/`                                                |
| REPL                 | `pnpm yap repl`       | Interactive session with persistent context. Supports multi-line input, FFI, expression evaluation |
| Tests                | `pnpm test`           | Vitest. Parser tests, inference tests (v1), evaluation tests (v2), unification tests               |
| Grammar regeneration | `pnpm run nearley`    | Recompile `grammar.ne` → `grammar.ts`                                                              |
| Type regeneration    | `pnpm run ts-dts`     | Regenerate tree-sitter types → `generated.d.ts`                                                    |
| Type checking        | `pnpm run typecheck`  | `tsc --noEmit`                                                                                     |

---

## Per-module Documentation

| Document                                        | Scope                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/parser/ARCHITECTURE.md`                    | Dual parser backends, grammar structure, AST vs CST, tree-sitter utilities                       |
| `src/elaboration/ARCHITECTURE.md`               | Bidirectional algorithm, dispatch maps, module organisation, monad, context, constraints, solver |
| `src/elaboration/normalization/ARCHITECTURE.md` | NbE engine: values, closures, stack-based evaluator, quoting, generalization                     |
| `src/verification/ARCHITECTURE.md`              | Liquid refinements, VC generation, SMT translation, Z3 integration, subtyping                    |
| `docs/V2-MIGRATION.md`                          | v1→v2 migration status, action plan, per-module inventory                                        |
| `docs/MIR-LOWERING.md`                          | MIR design and lowering plan (early draft): SSA, shift/reset, CRUD, FBIP                         |

---

## Design Decisions

| Decision                                  | Rationale                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Bidirectional inference**               | Natural fit for dependent types with annotations. `infer` synthesises, `check` pushes expected types inward                          |
| **NbE for equality**                      | Definitional equality checking via normalisation — evaluate to values, compare structurally                                          |
| **De Bruijn levels in NF, indices in EB** | Levels avoid shifting during weakening (NbE); indices are natural for syntactic binding                                              |
| **Deferred constraint solving**           | Constraints collected during inference, solved per-let-binding. Enables polymorphism via generalization                              |
| **Deferred verification**                 | Modality semantics (refinements, multiplicities) verified after elaboration, not during. Keeps elaboration focused on type inference |
| **Branded types**                         | `EB.Term` and `NF.Value` are branded (`Types.Brand<symbol, ...>`) to prevent accidental mixing of syntactic and semantic domains     |
| **Generator-based monad**                 | `V2.Do(function*() { ... })` provides readable imperative-style code with monadic sequencing, avoiding fp-ts pipe chains             |
| **Structural types via rows**             | Structs, tuples, variants, arrays are all row-based. Enables row polymorphism and uniform treatment                                  |
