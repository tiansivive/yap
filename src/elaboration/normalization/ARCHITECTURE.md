# Normalization Architecture

The normalization subsystem implements **Normalization by Evaluation (NbE)** — the semantic core of Yap's type checker. It evaluates elaborated terms (`EB.Term`) into semantic values (`NF.Value`), quotes them back, and handles generalization for let-polymorphism.

## Module Map

```
src/elaboration/normalization/
├── evaluation.v2.ts        # Stack-based trampoline evaluator (~1056 lines)
├── quoting.ts              # Quote: NF.Value → EB.Term (~111 lines)
├── generalization.ts       # Let-polymorphism generalization (~271 lines)
├── recursion.ts            # Mu-type unfolding (~23 lines)
├── patterns.ts             # Pattern → NF.Value compilation (~63 lines)
├── index.ts                # Barrel re-exports
├── syntax/
│   ├── term.ts             # NF.Value type definition (~250 lines)
│   ├── dsl.ts              # Smart constructors for primitives (~75 lines)
│   ├── pretty.ts           # NF.Value → string display (~131 lines)
│   └── traversal.ts        # Generic NF.Value traversal (~44 lines)
└── __tests__/
    ├── evaluation.v2.test.ts
    ├── force.test.ts
    └── generalization.test.ts
```

**~2035 lines** of source across 10 files + 3 test files.

## NF.Value — Semantic Domain (`syntax/term.ts`)

`Value` is a **branded type**: `Types.Brand<symbol, Constructor> & { id: number }`. Each value gets a unique monotonic ID.

### Constructors (8 variants)

| Variant    | Fields                             | Description                               |
| ---------- | ---------------------------------- | ----------------------------------------- |
| `Var`      | `variable: Variable`               | Variable reference                        |
| `Lit`      | `value: Literal`                   | Literal value                             |
| `App`      | `func, arg: Value; icit`           | Application                               |
| `Row`      | `row: Row`                         | Row value                                 |
| `Abs`      | `binder: Binder; closure: Closure` | Abstraction (Lambda, Pi, Mu, Sigma)       |
| `Neutral`  | `value: Value`                     | Stuck computation wrapper                 |
| `Modal`    | `value: Value; modalities`         | Modality-annotated value                  |
| `External` | `name, arity, compute, args`       | Primitive with partial application buffer |

### Variable (5 variants)

- `Bound { lvl }` — de Bruijn **level** (not index)
- `Free { name }` — free variable
- `Label { name }` — record label
- `Foreign { name }` — FFI binding
- `Meta { val, lvl }` — meta-variable with creation-scope level

### Binder (4 variants)

`Pi`, `Lambda`, `Mu`, `Sigma` — each with `variable: string` and `annotation: Value`. Pi/Lambda carry `icit: Implicitness`. Mu carries `source: string`.

### Closure (3 variants)

| Variant        | Fields                       | Description                                   |
| -------------- | ---------------------------- | --------------------------------------------- |
| `Closure`      | `ctx, term`                  | Standard closure — captures full `EB.Context` |
| `PrimOp`       | `ctx, term, arity, compute`  | Primitive operation with compute function     |
| `Continuation` | `ctx, term, frames, results` | Captured delimited continuation               |

### Sentinel Values

- `Type` = `Lit(Atom("Type"))` — the type of types
- `Row` = `Lit(Atom("Row"))` — the kind of rows
- `Any` = `Lit(Atom("Any"))` — the top type

### Structural Type Encoding

All structural types are encoded uniformly as `App(Lit(Atom(tag)), Row(row))`:

- `Struct(row)` = `App(Lit(Atom("Struct")), Row(row))`
- `Schema(row)` = `App(Lit(Atom("Schema")), Row(row))`
- `Variant(row)` = `App(Lit(Atom("Variant")), Row(row))`
- `Array(row)` = `App(Lit(Atom("Array")), Row(row))`

This encoding is consistent between the EB and NF domains.

### De Bruijn Levels vs Indices

NF.Value uses **levels** (`Bound { lvl }`); EB.Term uses **indices** (`Bound { index }`). Conversion happens in `quote` via `index = lvl - v.lvl - 1`. Levels simplify operations under binders (no shifting needed).

## Evaluator (`evaluation.v2.ts`)

### Stack-Based Trampoline

The evaluator uses a **stack-based trampoline** instead of recursive JS calls, preventing stack overflow on deeply recursive Yap programs.

Two **global mutable stacks** are shared across all evaluation calls:

- `globalWorkStack: StackFrame[]` — frames to process
- `globalResultStack: NF.Value[]` — completed values

Each `evaluate()` call tracks its initial stack position, enabling re-entrant calls to only process work they added.

### StackFrame (3 variants)

| Frame                           | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `Eval { ctx, term }`            | Schedule a term for evaluation                     |
| `Cont { arity, handler }`       | Pop `arity` results and call `handler(results)`    |
| `Delimiter { ctx, resultSize }` | Marks a reset boundary for delimited continuations |

### Main Loop

Pops frames from the work stack:

- `Eval` → dispatch to `evaluateTerm()`
- `Cont` → splice results, invoke handler
- `Delimiter` → no-op (pass-through boundary marker)

### evaluateTerm Dispatch

| Term type      | Behaviour                                                          |
| -------------- | ------------------------------------------------------------------ |
| `Lit`          | Push literal NF value                                              |
| `Var(Label)`   | Look up in `ctx.sigma`, evaluate if needed                         |
| `Var(Free)`    | Look up in `ctx.imports`; tie the knot for recursion               |
| `Var(Meta)`    | Check skolems, then zonker; unresolved → `Neutral`                 |
| `Var(Bound)`   | Look up in `ctx.env`; Mu-bound → `Neutral`                         |
| `Var(Foreign)` | Look up in `ctx.ffi`; creates `External` if arity > 0              |
| `Abs`          | Push `Cont` for annotation, construct binder with closure          |
| `App`          | Push `Cont(2)` + eval func + eval arg → `reduceAndPushStack`       |
| `Row`          | Set up sigma context, evaluate fields via `evalRowPush`            |
| `Match`        | Eval scrutinee; stuck → `StuckMatch`, otherwise → `matching`       |
| `Proj`         | Eval base → `projectValue`                                         |
| `Inj`          | Eval base + value → `injectValue`                                  |
| `Modal`        | Eval term + liquid, combine modalities                             |
| `Block`        | `processStatementsAndPush` (sequentially extends context)          |
| `Reset`        | Push `Delimiter` frame then eval inner                             |
| `Shift`        | Eval body; capture frames to nearest `Delimiter` as `Continuation` |

### Closure Application (`apply`)

- **`Closure`** — extends context with argument, recursively calls `evaluate`
- **`PrimOp`** — collects args; when fully saturated with no neutrals, calls `compute`
- **`Continuation`** — replays captured frames by restoring result stack + pushing captured work frames
- **Sigma** binders extend sigma env rather than regular env

### Reduction (`reduceAndPushStack` / `reduce`)

- `Neutral` → wrap in `Neutral(App(...))`
- `Abs(Mu)` → do NOT unfold, wrap in `Neutral` (deferred to unification)
- `Abs` → inline apply
- `Lit(Atom)` → constructor application (e.g. `Struct Row`)
- `External` → accumulate args; fully saturated + no neutrals → `compute`

### Force

`force(value)` peels `Neutral` wrappers and follows the zonker for flex metas. Returns the concrete value or rewraps unsolved metas.

### Neutrals

`Neutral` is the **stuckness marker**. Irreducible variables, unsolved metas, blocked projections — all wrapped in `Neutral(...)`. This is critical for the NbE approach: stuck computations are preserved structurally rather than erroring.

## Quoting (`quoting.ts`)

`quote(ctx, lvl, val) → EB.Term`

Reads back an NF.Value into an EB.Term:

| Value               | Action                                               |
| ------------------- | ---------------------------------------------------- |
| `Lit`               | → `EB.Lit`                                           |
| `Var(Bound)`        | Level → index conversion                             |
| `Var(Meta)`         | Follow zonker if resolved                            |
| `Neutral`           | Quote inner (strip neutral)                          |
| `Abs(Lambda/Pi/Mu)` | Apply to fresh rigid at `lvl`, quote body at `lvl+1` |
| `Abs(Sigma)`        | Apply to own annotation (no level increase)          |
| `Row`               | Recursively quote extensions                         |
| `App`               | Quote func + arg                                     |
| `External`          | Reconstruct as `App(Foreign, args...)`               |
| `Modal`             | Quote value + liquid                                 |

`closeVal(val, ctx, lvl)` creates a `Closure` from a value by quoting at `lvl+1`.

## Generalization (`generalization.ts`)

Implements **let-polymorphism** via meta-variable generalization.

### `generalize(ty, tm, ctx, resolutions, skolems)`

1. Collects free metas from both the type (`collectMetasNF`) and term (`collectMetasEB`)
2. Deduplicates; filters out resolved metas and skolems
3. **Scope filtering**: only metas at or beyond current context depth (`m.lvl >= ctx.env.length`) are generalized — outer-scope metas are left untouched
4. Builds extended context mapping each generalizable meta to a bound variable
5. Updates zonker to map each meta to its corresponding `Bound(lvl)`
6. Wraps the type in implicit Pi binders (inner to outer), quoting with properly scoped levels
7. Returns the generalized type + updated zonker

**Name generation**: Category-based via annotation shape — Type→`a,b,c...`, Row→`r,s,t...`, Pi→`F,G,H...`, Num→`n,o,p...`, Lambda→`f,g,h...`, fallback→`A,B,C...`.

### `instantiate(ty)`

Defaults unconstrained metas: Row metas → empty row, Type metas → `Any`.

### `trimClosureEnvs(val)`

Strips the first env entry from all closure contexts. Used post-elaboration when moving top-level recursive letdecs from `env` to `imports`.

## Mu-Type Unfolding (`recursion.ts`)

`unfoldMu(app) → Option<NF.Value>`

Unfolds `(μX. body) arg`:

1. If `func` is another `App`, recursively unfold inner application first
2. If `func` is `Abs(Mu)`, apply closure to itself (self-substitution), then reduce with argument
3. Otherwise → `None`

Mu-types are **not unfolded during evaluation** — they're wrapped in `Neutral` and deferred to unification. `unfoldMu` is invoked explicitly when progress requires it.

## Pattern Compilation (`patterns.ts`)

`evaluate(pat, ctx, binders) → NF.Value`

Converts elaborated patterns into NF values for matching:

- `Lit` → `NF.Lit`
- `Binder` → `NF.Var(Bound)` (lookup by name in binders array)
- `Row/Struct/Variant` → wrapped structural types
- `List` → indexed Array row
- `Wildcard` → `Lit(Atom("wildcard"))` placeholder

## Pattern Matching (`evaluation.v2.ts` → `meet`)

`meet(scrutinee, pattern, ctx)` returns `Option<MeetResult[]>` — binder/value pairs on success. Handles wildcards, binders, literals, array/list patterns (with rest-binding), struct/schema/variant rows, and atom patterns.

`matching(scrutinee, alternatives, ctx)` tries each alternative in sequence, returning the first successful match's evaluated body.

## DSL (`syntax/dsl.ts`)

Smart constructors wrapping `PrimOps`:

- **Unops**: `not`
- **Binops**: `and`, `or`, `lt`, `gt`, `lte`, `gte`, `eq`, `neq`, `add`, `sub`, `mul`, `div`
- **Apply**: `(icit, func, ...args)` — curried multi-argument application

## Pretty Printing (`syntax/pretty.ts`)

`display(value, ctx, opts)` renders NF values. Handles env lookup for bound vars, zonker following for metas, binder symbols (λ/Π/μ/Σ), and modality annotations. Optional `deBruijn: true` appends level annotations for debugging.

## Barrel Exports (`index.ts`)

```typescript
export * from "./quoting";
export * from "./syntax/term";
export * from "./syntax/pretty";
export * from "./syntax/traversal";
export * from "./generalization";
export * as DSL from "./syntax/dsl";
export * from "./recursion";
export * from "./evaluation.v2";
export * as Pats from "./patterns";
```

Consumers import as `import * as NF from "@yap/elaboration/normalization"`. All exports are flattened except `DSL` and `Pats` which are namespaced.
