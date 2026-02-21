# Verification Architecture

The verification subsystem implements **liquid refinement type checking** via translation to **Z3/SMT**. It takes elaborated, type-checked terms and generates verification conditions (VCs) that are discharged by the Z3 solver to ensure refinement predicates hold.

## Module Map

```
src/verification/
├── V2/
│   ├── index.ts                # Re-exports service
│   ├── service.ts              # Service factory entry point (~32 lines)
│   ├── check.ts                # Bidirectional checking against types (~293 lines)
│   ├── synth.ts                # Refinement type synthesis (~379 lines)
│   ├── subtype.ts              # Subtype relation → VCs (~450 lines)
│   ├── types.ts                # Verification API types (~50 lines)
│   ├── logic/
│   │   └── translate.ts        # NF.Value → Z3 expression translation (~280 lines)
│   └── utils/
│       ├── context.ts          # Runtime, obligations, context helpers (~135 lines)
│       └── refinements.ts      # Selfification, meet, modality extraction (~170 lines)
├── modalities/
│   ├── index.ts                # Re-exports Liquid + shared
│   ├── liquids.ts              # Liquid refinement predicates (~50 lines)
│   └── shared.ts               # Annotations, Artefacts, combine helpers (~65 lines)
└── __tests__/
    ├── helpers.ts              # Parse + elaborate test helper (~75 lines)
    ├── check.test.ts           # End-to-end verification tests (~554 lines)
    └── __snapshots__/
```

## Service Entry Point (`V2/service.ts`)

```typescript
VerificationServiceV2 = (Z3: Context<"main">, options?) => {
  check, synth, subtype, getObligations
}
```

The service:
1. Takes a pre-initialized Z3 context and optional logging config
2. Creates a `VerificationRuntime` (logging, obligation recording, fresh names)
3. Creates `TranslationTools` (NF → Z3 translation)
4. Composes the three core functions: `createSubtype`, `createCheck`, `createSynth`
5. Returns the public API

Verification is **on-demand** — invoked from the REPL, CLI, or module elaboration's `letdec` pipeline, not automatically during every compilation.

## Core Types (`V2/types.ts`)

| Type | Description |
|------|-------------|
| `VerificationArtefacts` | `{ vc: Expr; nf?: NF.Value }` — a Z3 VC + optional synthesized type |
| `CheckFn` | `(term, type) → Elaboration<VerificationArtefacts>` |
| `SynthFn` | `(term) → Elaboration<[NF.Value, VerificationArtefacts]>` |
| `SubtypeFn` | `(left, right) → Elaboration<Expr>` |
| `Obligation` | `{ label, expr, context? }` — recorded VC with debug metadata |
| `VerificationServiceAPI` | `{ check, synth, subtype, getObligations }` |

## Bidirectional Checking (`V2/check.ts`)

`check(term: EB.Term, type: NF.Value) → Elaboration<VerificationArtefacts>`

Dispatches on `[term, type]` pairs:

| Pattern | Description |
|---------|-------------|
| `[Modal, Type]` | Strip modal wrapper, recurse |
| `[Mu, _]` | Bind mu var in context, check body |
| `[_, App]` (unfoldable mu) | Unfold mu-type, recurse |
| `[Abs, Pi]` | Lambda checking: bind param, extract liquid from Pi annotation, translate to Z3, produce `∀x. φ(x) ⇒ body_vc` |
| `[Array, Indexed]` | Trivially `true` |
| `[Struct, Sigma]` | Evaluate struct, apply sigma closure, recurse |
| `[Struct, Variant]` | Row containment: each label must check against variant |
| `[Struct, Schema]` | Row-wise traversal: check each field, collect sigma bindings |
| `[Match, _]` | Synth scrutinee, per alternative: synth pattern, compute meet, check branch under binders, quantify |
| **fallthrough** | Synth term type → subtype against expected |

## Refinement Synthesis (`V2/synth.ts`)

`synth(term: EB.Term) → Elaboration<[NF.Value, VerificationArtefacts]>`

Synthesizes both a type and a VC:

| Pattern | Description |
|---------|-------------|
| `Var(Bound)` | Look up in env, **selfify** (`v == term`), translate |
| `Var(Free)` | Look up in imports, extract modalities |
| `Var(Label)` | Look up in sigma |
| `Lit` | Map to base type, selfify (`λv. v == literal`) |
| `Pi/Mu/Sigma/Variant/Schema/Row` | Type formers → `Type` with trivial VC |
| `Lambda` | Synth body under extended context → Pi type |
| `Struct` | Synth each field → Schema type |
| `App` | Synth function, **incorporate** argument: check arg against Pi domain, apply closure, wrap in Existential (modified Syn-App-Ex rule) |
| `Block` | Process let statements: check bindings, quantify VCs, wrap in Existentials |
| `Proj` | Synth base, project label from Schema/Sigma row |
| `Inj` | Synth base + value, inject into row |

### Selfification

A key technique: when synthesizing a variable or literal, the system strengthens the type with a refinement asserting `v == x`. This is essential for precise dependent reasoning — it propagates exact value information through the refinement logic.

## Subtype Relation (`V2/subtype.ts`)

`subtype(left: NF.Value, right: NF.Value) → Elaboration<Expr>`

Returns a Z3 `Bool` expression — the verification condition for the subtyping judgment.

### Rule Categories

**Structural subtyping:**
- Literal/rigid variable equality
- Row/Schema/Variant containment
- Sigma subtyping (covariant in body)
- Schema ↔ Sigma interop
- Mu-type structural equality

**Pi subtyping:**
- Contravariant in parameter, covariant in result
- For first-order parameters: extracts liquid, quantifies `∀x. φ(x) ⇒ body_vc`

**Modal subtyping (core refinement rule):**
- `Modal <: Modal` — checks base type subtyping, then for both liquid predicates: applies to fresh rigid, translates to Z3, produces `∀x. φ_left(x) ⇒ φ_right(x)`
- `Modal <: _` / `_ <: Modal` — lift the non-modal side with neutral refinement (`λv. true`)

**Existential elimination:**
- Left existential: extend context, quantify VC over witness
- Right existential: extend context, solve body

**Mu-type unfolding:**
- Unfold mu on either side to make progress

**Row subtyping** via `contains(a, b)`: fold over row `b`, rewrite each label in `a`, recursively subtype matched values.

## SMT Translation (`V2/logic/translate.ts`)

### Type → Sort Mapping

| Yap Type | Z3 Sort |
|----------|---------|
| `Num` | `Z3.Real.sort()` |
| `Bool` | `Z3.Bool.sort()` |
| `String` | Uninterpreted `"String"` |
| `Unit` | Uninterpreted `"Unit"` |
| `Type` | Uninterpreted `"Type"` |
| `Row/Schema/Sigma/Variant/Indexed` | Uninterpreted `"Schema"` or `"Row"` |
| `Mu` | Uninterpreted `"Mu_{source}"` |
| `Pi/Lambda` | `"Function"` or SMTArray |
| `External` | Uninterpreted `"External:{name}"` |

### Term → Expr Translation

| Yap Value | Z3 Expression |
|-----------|---------------|
| `Lit(Num v)` | `Z3.Real.val(v)` |
| `Lit(Bool v)` | `Z3.Bool.val(v)` |
| `Var(Bound lvl)` | Look up in `rigids` map or create `Z3.Const(name, sort)` |
| `Var(Free name)` | Evaluate import, translate recursively |
| `App(f, arg)` | SMT array select: `mkFunction(f).select(args...)` |
| `External` (fully applied) | Direct Z3 ops: `+` → `.add()`, `>` → `.gt()`, `==` → `.eq()`, etc. |

**Function representation**: Higher-order functions are modeled as **SMT arrays** with application via `select`.

### Quantification

`quantify(variable, annotation, vc, ctx)` produces `∀x. φ(x) ⇒ vc` when the annotation has a liquid refinement, or `∀x. vc` otherwise. Handles nested existentials recursively. Skips quantification for Pi-typed variables.

## Modalities

### Liquid Refinements (`modalities/liquids.ts`)

| Constructor | Description |
|-------------|-------------|
| `Predicate.Kind(ctx, arg)` | Creates Pi type `arg → Bool` — the kind of predicates |
| `Predicate.Neutral(ann)` | `λ_. true` — trivially true refinement (as EB.Term) |
| `Predicate.NeutralNF(ann, ctx)` | Same as NF.Value closure |
| `Predicate.True(Z3)` | `Z3.Bool.val(true)` |

### Shared (`modalities/shared.ts`)

| Export | Description |
|--------|-------------|
| `Annotations<T>` | `{ quantity: Q.Multiplicity; liquid: T }` |
| `Artefacts` | `{ usages: Q.Usages; vc: Expr }` |
| `Verification.implication(p, q)` | Encodes `p ⇒ q` as `¬p ∨ q` in NF values |
| `Verification.imply(ctx, ann, p, q)` | Creates lambda conjoining assumptions |
| `combine(a, b, ctx)` | Combines annotations: multiply quantities, conjoin liquids |

### QTT Multiplicities

Multiplicities (`Zero`, `One`, `Many`) are defined in `src/shared/modalities/multiplicity.ts` (a semiring). They are structurally paired with liquid refinements in `Annotations<T>` but **multiplicity checking is not yet implemented** in the verification pass — it is deferred to future work.

## Utilities

### Context (`V2/utils/context.ts`)

| Export | Description |
|--------|-------------|
| `VerificationRuntime` | Logging, obligation recording, fresh names |
| `createRuntime(options)` | Factory with `$a`–`$z`–`$aa`... name counter |
| `noCapture(ctx)` | Empty-env context to prevent variable capture |
| `extendContext(ctx, binder, value, ann)` | Prepend env entry |
| `applyClosure(binder, closure, value, ann)` | Evaluate closure under extension |
| `collectSigmaBindings(r1, r2)` | Parallel row traversal for dependent records |

### Refinements (`V2/utils/refinements.ts`)

| Export | Description |
|--------|-------------|
| `selfify(tm, ty, ctx)` | Strengthen type with `v == tm` |
| `meet(ctx, scrutineeTy, patternTy)` | Greatest lower bound — conjoin liquid predicates |
| `meetRow(ctx, sRow, pRow)` | Label-by-label row meet |
| `extractModalities(nf, ctx)` | Extract `{ quantity, liquid }` from Modal |
| `isFirstOrder(ty)` | False for Pi/Lambda/Sigma — guards Z3 translation |

## Test Patterns

Tests in `__tests__/check.test.ts` (~554 lines, ~21 tests):

1. Parse + elaborate via `elaborate(src)` helper
2. Create `VerificationService(Z3)`
3. Run `check(tm, ty)` inside V2 monad
4. Add `vc.eq(true)` to Z3 solver
5. Assert satisfiability: `"sat"` (VC holds) or `"unsat"` (violation)
6. Snapshot Z3 S-expressions

**Test categories**: basic refinements, type aliases (`Nat`, `Pos`), function definitions (HOF, pre/postconditions, dependent refinements), blocks with lets, dependent records, flow-sensitive refinement via match.
