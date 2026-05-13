# Elaboration Architecture

The elaboration module implements **bidirectional type inference and checking** over the source AST (`Src.Term`), producing an elaborated core language (`EB.Term`) with solved metas, inferred types, and verification obligations. It is the central subsystem of the Yap compiler.

## Module Map

```
src/elaboration/
├── elaborate.ts              # Inference dispatch map (Src.Term → handler)
├── check.ts                  # Checking dispatch (term × type → handler)
├── module.ts                 # Top-level module elaboration
├── implicits.ts              # Implicit insertion, wrapping, instantiation
├── modalities.ts             # Liquid refinement typechecking bridge
├── predicates.ts             # Type guards (isLambda, isImplicitPiAbs)
├── index.ts                  # Barrel re-exports
│
├── shared/                   # Cross-cutting infrastructure
│   ├── monad.v2.ts           # V2 elaboration monad (ReaderWriterStateEither)
│   ├── context.ts            # Context type + manipulators
│   ├── supply.ts             # Fresh meta/var ID generation
│   ├── metas.ts              # Meta collection (walk NF/EB for unsolved metas)
│   ├── errors.ts             # Error types + display
│   └── monad.ts              # V1 monad (deprecated, reference only)
│
├── solver/                   # Constraint solving
│   ├── solver.ts             # Solve: constraints → zonker + resolutions
│   └── nondeterminism.ts     # Replay over nondeterministic solutions
│
├── unification/              # First-order unification
│   ├── unification.ts        # Core unify(left, right) → Subst
│   └── rows.ts               # Row unification (label rewriting)
│
├── normalization/             # NbE engine (see normalization/ARCHITECTURE.md)
│
├── syntax/                   # EB.Term definition + utilities
│   ├── term.ts               # EB.Term type (branded, de Bruijn indices)
│   ├── dsl.ts                # Smart constructors for FFI primitives
│   ├── traversal.ts          # Generic EB.Term traversal
│   └── pretty.ts             # EB.Term → string display
│
├── pretty/                   # Pretty printing
│   ├── pretty.ts             # EB.Term display with context
│   ├── index.ts              # Barrel
│   └── pretty.test.ts        # Tests
│
├── inference/                # V1 inference modules (by term shape)
│   └── __tests__/            # Inference tests
│
├── inference.v2/             # V2 inference modules (CST-based, migration)
│
├── checking/                 # V1 checking modules
│
├── checking.v2/              # V2 checking modules (by type shape, migration)
│
└── __tests__/                # Module-level elaboration tests
```

## Inference Dispatch (`elaborate.ts`)

`infer` dispatches on `Src.Term.type` via `ts-pattern`:

| Term shape     | Handler                    |
| -------------- | -------------------------- |
| `var`          | `EB.lookup(variable, ctx)` |
| `lit`          | `EB.Lit.infer`             |
| `hole`         | `EB.Hole.infer`            |
| `row`          | `EB.Rows.infer`            |
| `projection`   | `EB.Proj.infer`            |
| `injection`    | `EB.Inj.infer`             |
| `struct`       | `EB.Struct.infer`          |
| `tuple`        | `EB.Tuples.infer`          |
| `list`         | `EB.List.infer`            |
| `dict`         | `EB.Dict.infer`            |
| `variant`      | `EB.Variant.infer`         |
| `tagged`       | `EB.Tagged.infer`          |
| `pi` / `arrow` | `EB.Pi.infer`              |
| `lambda`       | `EB.Lambda.infer`          |
| `application`  | `EB.Application.infer`     |
| `match`        | `EB.Match.infer`           |
| `block`        | `EB.Block.infer`           |
| `modal`        | `EB.Modal.infer`           |
| `annotation`   | `EB.Annotation.infer`      |
| `reset`        | `EB.Reset.infer`           |
| `shift`        | `EB.Shift.infer`           |
| `resume`       | `EB.Shift.resume`          |

Return type: `AST = [EB.Term, NF.Value, Q.Usages]`. Modalities are stripped from the result type via `stripModalities` — verification is a separate pass.

## Checking (`check.ts`)

`check(term, type)` dispatches on `[term, type]` pairs — organized **by type shape**:

| Pattern                   | Behaviour                                           |
| ------------------------- | --------------------------------------------------- |
| `[hole, _]`               | Fresh meta of fresh kind                            |
| `[lambda, Pi{same icit}]` | Bind param, check body against applied Pi           |
| `[_, implicit Pi]`        | Auto-insert implicit lambda, recurse                |
| `[variant, Type]`         | Check row at Type level                             |
| `[tuple, Type]`           | Check row → Schema                                  |
| `[struct, Type]`          | Check row → Sigma                                   |
| `[injection, Type]`       | Check injection value & term                        |
| `[struct, HashMap]`       | Check row values against hashmap value type         |
| `[struct, Schema]`        | Traverse-check row against schema row               |
| `[struct, Sigma]`         | Infer struct, apply sigma closure, constrain        |
| `[match, Type]`           | Infer scrutinee, check each alternative             |
| `[match, _]`              | Narrow context per branch, check alternatives       |
| `[Num lit, Num lit]`      | Literal equality                                    |
| `[Num lit, Type]`         | Literal at Type level                               |
| `[_, Modal]`              | Strip modal, check underlying                       |
| `[modal, _]`              | Check inner, typecheck liquid, wrap                 |
| **fallthrough**           | Infer + insert implicits + emit `assign` constraint |

**Note:** Curry-style functional patterns (patterns with function symbols, unification/residuation) would require elaboration redesign. See docs/MIR-LOWERING.md §9.1.

## Monad (`shared/monad.v2.ts`)

```
Elaboration<A> = (ctx: Context, w?: Accumulator, st?: MutState) => [Collector<A>, MutState]
```

A **ReaderWriterStateEither** monad using generators for Do-notation.

### Collector (Writer output)

| Channel       | Type                           | Purpose                         |
| ------------- | ------------------------------ | ------------------------------- |
| `constraints` | `WithProvenance<Constraint>[]` | Unification/resolve constraints |
| `binders`     | `Binder[]`                     | Encountered binders             |
| `metas`       | `Record<number, {meta, ann}>`  | Fresh metas created             |
| `zonker`      | `Subst`                        | Accumulated substitution        |
| `types`       | `Record<id, {nf, modalities}>` | Typed term annotations          |
| `result`      | `Either<Err, A>`               | The computation result          |

### MutState

- `delimitations` — shift/reset stack (answer types, shifted flag)
- `skolems` — skolem variable map
- `nondeterminism.solution` — nondeterministic unification solutions

### Key Operations

| Operation                                  | Purpose                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `Do(gen)`                                  | Generator-based do-notation. Short-circuits on `Left`.    |
| `of(a)`                                    | Pure/return                                               |
| `ask()` / `asks(fn)`                       | Reader: access context                                    |
| `local(modify, ma)`                        | Reader: run with modified context                         |
| `tell(channel, payload)`                   | Writer: emit to constraint, binder, meta, type, or zonker |
| `listen()`                                 | Writer: retrieve accumulated output                       |
| `fail(cause)`                              | Error: short-circuit with cause + provenance + ctx        |
| `pure(ma)`                                 | Lift `Elaboration<A>` into generator                      |
| `regen(f)`                                 | Attach `.gen` helper for yieldable wrapping               |
| `track(provenance, fa)`                    | Extend trace stack for error provenance                   |
| `fold`, `traverse`                         | Collection combinators                                    |
| `getSt` / `putSt` / `modifySt` / `localSt` | Mutable state operations                                  |

## Context (`shared/context.ts`)

```typescript
type Context = {
	env: Array<{ type: [Binder, Origin, NF.Value]; nf: NF.Value; name: Binder }>;
	implicits: Array<[EB.Term, NF.Value]>;
	sigma: Record<string, Sigma>;
	zonker: Subst;
	metas: Record<number, { meta: EB.Meta; ann: NF.Value }>;
	imports: Record<string, EB.AST>;
	ffi: Record<string, { arity: number; compute: (...args: NF.Value[]) => NF.Value }>;
	trace: Stack<Provenance>;
};
```

| Field       | Role                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `env`       | De Bruijn–indexed environment. Each entry: binder name, origin (`source`/`inserted`), type as `NF.Value`, and value. |
| `implicits` | Implicit instances in scope (from `using` declarations).                                                             |
| `sigma`     | Named field/label environment for struct projections.                                                                |
| `zonker`    | Accumulated substitution from solved metas.                                                                          |
| `metas`     | Registry of all created metas with annotations.                                                                      |
| `imports`   | Top-level names from prior declarations or module imports.                                                           |
| `ffi`       | Foreign function interface: name → arity + JS compute function.                                                      |
| `trace`     | Provenance stack for error reporting.                                                                                |

**Context manipulators:** `bind`, `extend`, `augment`, `unfoldMu`, `extendSigma`, `extendSigmaEnv`, `muContext`, `prune`, `lookup`.

## Meta Variable Lifecycle

1. **Creation** (`supply.ts`): `freshMeta(lvl, ann)` increments a global counter, creates `Meta = {type:"Meta", val, lvl}`, emits via `V2.tell("meta", ...)`.

2. **Constraint emission**: During elaboration, `V2.tell("constraint", {type:"assign", left, right})` records unification obligations. Implicit insertion emits `{type:"resolve", meta, value, implicits}`.

3. **Solving** (`solver/solver.ts`): `solve(constraints)` processes assignment constraints sequentially — each calls `U.unify(left, right, lvl, subst)`, threading substitutions. After unification, `resolve()` attempts to find implicit solutions by unifying against in-scope implicits, rejecting solutions that over-constrain other metas.

4. **Zonking** (`implicits.ts` → `instantiate`): Resolved metas → their resolution term. Constrained metas → quoted from zonker. Unconstrained metas → type-based defaults.

## Unification (`unification/unification.ts`)

`unify(left, right, lvl, subst) → V2.Elaboration<Subst>`

Forces both sides via zonker, then dispatches:

| Pattern                         | Action                                           |
| ------------------------------- | ------------------------------------------------ |
| `Flex ↔ Flex`                  | Bind one to other + unify annotations            |
| `Flex ↔ solved`                | Follow substitution, recurse                     |
| `Flex ↔ _` / `_ ↔ Flex`       | Bind meta to value (with occurs check)           |
| `Lambda ↔ Lambda`              | Apply both to fresh rigid, unify bodies at lvl+1 |
| `Pi ↔ Pi`                      | Unify annotations, compose subst, unify bodies   |
| `Mu ↔ Mu`                      | Unify annotations + bodies                       |
| `_ ↔ Mu` / `Mu ↔ _`           | Unfold mu and recurse                            |
| `Schema/Struct/Variant ↔ same` | Unify args                                       |
| `App ↔ App`                    | Unify func+arg; mu-unfolding if blocked          |
| `Row ↔ Row`                    | Delegate to `Row.unify` (label rewriting)        |
| **otherwise**                   | `TypeMismatch` error                             |

**Row unification** (`rows.ts`): Handles empty↔empty, variable↔variable, meta row variables (follow/bind), and extension↔\_ (rewrite to find matching label, unify value, recurse on tail).

## Implicit Resolution (`implicits.ts`)

- **`insert(ast)`**: After inference, if result type is an implicit Pi, auto-applies fresh meta and emits `resolve` constraint. Recurses until no implicits remain.
- **`wrapLambda(term, ty, ctx)`**: Wraps term in implicit lambda if type demands it.
- **`instantiate(term, ctx, resolutions)`**: Post-solving zonking pass — replaces metas with solutions.

## Module Elaboration (`module.ts`)

`elaborate(mod, ctx)` processes a `Src.Module` sequentially:

1. Iterates statements, threading context.
2. **`using`** → infer, add to `ctx.implicits`.
3. **`foreign`** → check annotation at `NF.Type`, register in `ctx.imports`.
4. **`let`** → full pipeline: infer → collect constraints/metas → solve → generalize → instantiate → wrap implicits → Z3 verification → register in `ctx.imports`.
5. Exports filtered by module export policy.
6. Returns `{foreign, exports, letdecs, errors}`.

## Error Types (`shared/errors.ts`)

```typescript
type Cause =
	| { type: "UnificationFailure"; left: NF.Value; right: NF.Value }
	| { type: "RigidVariableMismatch"; left: NF.Value; right: NF.Value }
	| { type: "RowMismatch"; left: NF.Row; right: NF.Row; reason: string }
	| { type: "MissingLabel"; label: string; row: Row<any, any> }
	| { type: "TypeMismatch"; left: NF.Value; right: NF.Value }
	| { type: "Impossible"; message: string; extra?: any }
	| { type: "MultiplicityMismatch"; expected; right; reason? };
```

Errors are enriched with provenance (trace stack) and the context at point of failure.

## Pretty Printing (`pretty/pretty.ts`)

`display(term, ctx, opts)` renders `EB.Term` as a string. Variables are resolved by env lookup (bound), name (free), or zonker (metas). Verbose mode shows de Bruijn indices and meta annotations.

## V2 Migration Modules

- **`inference.v2/`** — CST-based inference (by term shape). 22/23 modules implemented; `tmp.ts` stub blocks wiring.
- **`checking.v2/`** — CST-based checking (by type shape). Row-based + Pi checking complete (8 modules): `check.ts` (dispatcher), `pi.ts`, `struct.ts`, `row.ts`, `variant.ts`, `tuple.ts`, `injection.ts`, `tagged.ts`. Still missing: `match.ts`, `modal.ts`. `tmp.ts` stub blocks wiring.

See `docs/V2-MIGRATION.md` for current status and migration plan.
