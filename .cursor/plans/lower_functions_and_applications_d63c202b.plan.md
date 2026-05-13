---
name: Lower Functions and Applications
overview: Plan for implementing lowering of Lambda and general App in the Yap MIR pipeline, including MIR extensions (Call with tagged targets, closure support), closure conversion with func ptr + env records, and application lowering. Incorporates decisions from discussion and the compiling-functions reference doc.
todos:
  - id: rename-lir-mir
    content: Rename lir.ts to mir.ts; update imports, LIR→MIR names, comments, docs (first step)
    status: completed
  - id: doc-mir
    content: Update MIR-LOWERING.md with Call target union, closure layout, spine note
    status: completed
  - id: doc-roadmap
    content: Add lowering/compilation vision to ROADMAP or create LOWERING-VISION.md
    status: pending
  - id: mir-call
    content: Add Call instruction with CallTarget discriminated union to mir.ts
    status: completed
  - id: mir-fnref
    content: Add Expr.FuncRef; closure as Record (no special allocation)
    status: completed
  - id: lower-app
    content: Lower App(f, arg); Phase 1 indirect only (direct reserved for future top-level fn refs)
    status: completed
  - id: lower-lambda
    content: Lower Lambda with closure conversion (nested supported)
    status: completed
  - id: lower-module
    content: Change lowerToMir to return Module, accumulate functions
    status: completed
  - id: tests
    content: Add tests for lambda, nested lambda, indirect call, λx.x as whole term; switch to Module, use display.module, snapshot full module
    status: completed
isProject: false
---

# Plan: Lowering Functions and Applications

## Design Decisions (Confirmed)

| Decision               | Choice                                          | Rationale                                                                                                                                              |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Module vs Function** | Prefer **Module**                               | Flat functions per closure; cleaner call graph; MIR spec already has `Module`                                                                          |
| **Closure layout**     | **Func pointer + env record**                   | Portable, debuggable, C-friendly; per [compiling-functions reference](https://docs.google.com/document/d/14wg1bZLiH5juTeLV0VN0fSchQs3VXymxfoVSxXAAtX8) |
| **Call instruction**   | **Single Call with discriminated union target** | Target is `direct` (reserved for future top-level fn refs / closed-lambda opt) or `indirect` (callee in SSA var); Phase 1 uses indirect only           |
| **Closure creation**   | **FnRef + Record**                              | Add `Expr.FuncRef`; closure = regular Record with `__fn` (FuncRef) and `__env`; expand Call to Read + Call(indirect)                                   |
| **Implicits**          | Resolved before lowering                        | Elaboration inserts implicits; MIR sees only explicit lambdas and apps                                                                                 |
| **Nested lambdas**     | **Support from the start**                      | `λx.λy.body` lowers to nested closures                                                                                                                 |
| **Phase 1 strategy**   | Always closure-convert (no escape analysis)     | Simpler; add inlining/escape analysis later                                                                                                            |

---

## Phase 1 Scope (In / Out)

**In scope:**

- Single expression: literals, vars, primitives, struct/proj/inj, lambdas, applications
- Nested lambdas (`λx.λy.body`)
- Inline applications (`(λx.x) 42`, `f a b` curried)
- No Block, Let, Match, Reset/Shift

**Out of scope for Phase 1:**

- Block, Let, Match — so no `let f = λx.x in f 1`
- Module-level definitions — `lowerToMir(term)` compiles one expression; no multi-definition module context
- Shift/reset, continuation handling
- Direct-call optimization (convention in CallTarget, not implemented)
- Recursive closures (`let rec` / fix) — see §13

---

## Current State

- **Implemented**: Lit, Var (Bound/Free/Foreign), primitive App (e.g. `add(1,2)`), Struct/Proj/Inj, **Lambda** (closure conversion, nested), **App** (indirect calls)
- **Not implemented**: Block, Match, Let, Reset/Shift
- **IR** (`src/lowering/mir.ts`): MIR naming. Has `Let`, `Read`, `Update` (modes `immutable`, `fbip`), `Alloc`, `PrimOp`, `Call` (direct/indirect), `Expr.FuncRef`; closure = Record `{ __fn, __env }`
- **lowerToMir** returns `Module` with `[main, ...functions]`; lifted closure bodies included

---

## 1. MIR Extensions

### Call instruction (single, tagged target)

```ts
type CallTarget =
  | { type: "direct"; func: string }        // compile-time known function name
  | { type: "indirect"; callee: string };   // SSA var holding fn ptr (from closure or param)

| { type: "Call"; target: CallTarget; args: string[]; result: string }
```

Closure calls expand to `Call(indirect, fnVar, [envVar, ...args])` where fnVar and envVar come from Read.

- **direct**: `Call({ type: "direct", func: "foo" }, ["a", "b"], "r")` → call `foo(a, b)` directly (no closure indirection)
- **indirect**: `Call({ type: "indirect", callee: "fnVar" }, [envVar, ...args], "r")` → call through fnVar (load callee, call with args). Closure calls expand to Read **fn, **env, then Call(indirect, fnVar, [envVar, ...args]).

**FnRef + expand in MIR** (aligns with fnptr): Add `Expr.FuncRef(name: string)`. Closure = Record with `__fn` and `__env`. When lowering a closure call, expand to Read **fn, **env, then `Call(indirect, fnVar, [envVar, ...args])`. Backend sees plain Read + Call; no special closure handling. "Indirect" is backend-neutral (standard term for call-through-pointer).

**Why keep direct?** Reserved for future top-level function references and closed-lambda optimization. **Phase 1**: all calls use `indirect`.

### Closure layout (func ptr + env record)

Per the reference doc: closure = `{ fn: code_ptr; env: env_record }`.

- **Closure = regular Record** with `__fn` and `__env`. No special Alloc(Closure).
- Add `Expr.FuncRef(name: string)` so we can bind a function reference.
- Layout: `{ __fn: fnVar, __env: envRef }` where fnVar from `Let fn = FuncRef("f_0")`.

### Closure creation (FnRef + Record)

```ts
// Add to Expr:
| { type: "FuncRef"; name: string }

// Lowering sequence for λx.body:
// 1. Alloc env: Alloc({ type: "Record", fields: [...] }, envRef)
// 2. Emit function with params [env, x]
// 3. Let fn = FuncRef("f_0"); Alloc(Record, [{__fn, fn}, {__env, envRef}], result)
```

The lowering pass: (1) allocates env, (2) emits the function, (3) binds FuncRef, (4) allocates closure as Record.

---

## 2. Lambda Lowering (Closure Conversion)

**Strategy**: Always closure-convert. No escape analysis in Phase 1.

**Flow** (including nested lambdas):

1. For `Abs(Lambda, x, body)`: compute free vars of body (de Bruijn indices >= 1)
2. Map free indices to names via `ctx.bound`
3. Recursively lower nested lambdas in body first; each produces a closure or function
4. Create function with params `[env, x]` (or `[x]` if no free vars)
5. Alloc env record with captured values
6. Let fn = FuncRef(funcName); Alloc(Record, [{__fn, fn}, {__env, env}], result); return closure value

**Free variable collection**: Implement `freeVars(term: EB.Term, depth: number): Set<number>`. `depth` = number of lambda binders we're currently inside. `Bound(i)` is free when `i >= depth`.

**Closed lambdas** (no free vars): Uniform calling convention — params = `[env, x]` (same as capturing lambdas); caller always passes `[envVar, arg]`. Allocate empty env record for `__env`; closure layout uniform. (Empty-env allocation will be optimized later.)

**Env field order**: Deterministic — sort free var indices ascending; use field names derived from `ctx.bound` (e.g. `v1`, `v2`) or original binder names. Ensures stable closure layout.

---

## 3. Application Lowering

**Curried application**: `f a b` = `App(App(f, a), b)`. Lower recursively.

**Callee types**:

- **Direct** (Phase 2+): `Var(Free "foo")` or `Var(Bound i)` when ctx maps to a top-level function name → `Call({ type: "direct", func: name }, args, result)`. Reserved for future top-level fn refs and closed-lambda optimization.
- **Indirect** (Phase 1): Callee is closure value or param → expand to Read `__fn`, `__env`, then `Call(indirect, fnVar, [envVar, ...args])`.
- **Primitive**: already handled by `unwrapPrimitiveApp`
- **Struct**: already handled by `StructApp` pattern — `App(Struct, Row)` is record construction, not a function call; lower to `Alloc` with fields. No `Call` instruction.

**Phase 1 clarification**: All callees are closures (from lambda lowering or from params). `Var(Free)` and `Var(Bound)` in Phase 1 refer to closure values; treat as indirect. Direct is reserved for future top-level function references.

**Continuation vs normal App**: `App(k, v)` where `k` is shift continuation binder → `Resume`, not `Call`. Requires `LowerCtx.continuation`. (Deferred — no shift/reset in Phase 1.)

---

## 4. Context and API Changes

**LowerCtx** (`[src/lowering/context.ts](src/lowering/context.ts)`):

- Add `continuation?: Map<number, { block: Label; frame: string }>` for shift/reset (later phase)
- Add `nextFuncName: () => string` for closure function names (e.g. `f_0`, `f_1`). **Supply is global** — `lowerToMir` does NOT call `resetSupply()`. Extend `resetSupply()` to also reset the func-name counter so tests get deterministic names. Caller (e.g. tests) calls `resetSupply()` before lowering if they need deterministic names. For incremental/multi-module compilation we want global unique names. Document in lowering docs and testing.mdc.

**LowerResult** — extend to carry new functions:

- Add `functions: Function[]` — functions created while lowering this term (e.g. from lambdas). Merge when recursing.
- `lower` returns `{ instrs, value, functions }`; lambdas push to `functions`.
- **Merge rule**: Depth-first. When we create a function from a lambda, we recurse into the body first. Result: `functions = [...bodyFunctions, newFunction]`. So inner functions first.

**lowerToMir**:

- **Change**: `lowerToMir(term) → Module` (not `Function`)
- Collect `functions` from `lower`; main term becomes `main` function; return `Module { functions: [main, ...collected] }`
- **Caller updates**: `Pretty.display.module` already exists. Switch tests to operate on `Module` instead of `Function`: call `lowerToMir(term)` (returns `Module`), then `Pretty.display.module(mod)` and snapshot the full module. No new pretty-printer work; update lower.test.ts to use `display.module(mod)` instead of `display(fn)`.

**Function ordering and merge — depth-first:**

Example: `λx.λy.x+y`. Lower outer → body is `λy.x+y`. Lower inner first: creates `f_inner` (params `[env, y]`), alloc env `{x}`, alloc closure, return closure. Inner returns `{ instrs, value: closureRef, functions: [f_inner] }`. Outer creates `f_outer` (params `[x]`), body = inner's instrs + return. Merge: `[...bodyFunctions, newFunction]` → `[f_inner, f_outer]`.

**Merge options:**

| Option              | Rule                    | Result for λx.λy.x+y | Typical compilers                                                                                          |
| ------------------- | ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Depth-first**     | `bodyFunctions + [new]` | `[f_inner, f_outer]` | Common for closure conversion; inner functions don't reference outer ones; avoids forward-decl issues in C |
| **Outer-first**     | `[new] + bodyFunctions` | `[f_outer, f_inner]` | Some compilers emit in source order                                                                        |
| **Encounter order** | Append as we create     | Depends on traversal | GCC/LLVM often arbitrary; backend doesn't care                                                             |

**Choice**: Depth-first. Rationale: inner functions don't reference outer ones; outer references inner via closure. Depth-first avoids forward-declaration issues in C-like backends.

---

## 5. Alternatives to Closure Conversion (Reference Doc)

Registered for future consideration; we start with simple fnptr + env records.

| Strategy                    | Description                                           | When to consider                                         |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| **Defunctionalisation**     | Tag + env; central `apply(tag, env, args)` dispatcher | Shift/reset (continuations); GC; closure introspection   |
| **Lambda lifting**          | Lift to top-level; pass free vars as extra args       | When free vars known at call sites; limited higher-order |
| **Inlining**                | Expand lambda at use site                             | Non-escaping lambdas; escape analysis required           |
| **Hybrid (fnptr + defunc)** | Fnptr for normal lambdas; defunc for control effects  | Per reference doc: fnptr default, defunc for shift/reset |

---

## 6. Shift/Reset and CPS (Reference Doc, Deferred)

The reference doc recommends:

- **Normal lambdas**: Function pointers + explicit closure structs
- **Shift/reset**: CPS transform → defunctionalise continuations → state machine (while loop + switch)

**Our stance**: Aim to **avoid CPS** if possible. MIR-LOWERING.md already describes a **direct-style state machine** (blocks, jumps, `MakeCont`, `Resume`) that does not require global CPS. We should pursue that path first; CPS is a fallback if the direct approach proves insufficient for multi-shot or escaping continuations.

---

## 7. Spines (Future, Document Impact)

**Current**: Unary lambdas and apps. **Goal**: Spineful representation (multi-arg, explicit arity).

**Timeline**: Spines are coming sooner rather than later, but likely after the first lowering implementation.

**How spines help** (from reference doc and ROADMAP):

- **Arity known**: Generate multi-arg C functions; no curry chains
- **Partial application**: One closure per lambda (not chain of unary closures)
- **Defunc blowup**: Smaller — spine handles application; defunc only for full lambdas when needed
- **Codegen**: Lower pressure; one closure per lambda, spine drives application

**Design implication**: Make MIR decisions that accommodate spines — e.g. closure layout can evolve to "one struct per partial-arity" without fundamental redesign. Document in MIR-LOWERING.md.

---

## 8. Long-Term Vision (Reference Doc)

| Goal                            | Notes                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Rust-like output**            | Predictable, debuggable, minimal runtime                                                           |
| **No GC by default**            | Arena/region allocation for closures and continuation state                                        |
| **Optimisation before backend** | Monomorphisation, inlining, specialisation, escape analysis — no defunc needed for normal lambdas  |
| **Pragma steering (later)**     | Optional per-type/per-function lowering hints (fnptr, defunc, inline, arena); scalpel, not default |
| **Two strategies**              | Fnptr for normal lambdas; CPS+defunc (or direct state machine) for shift/reset                     |

---

## 9. Implementation Order

**Note**: The codebase currently uses LIR naming (`lir.ts`, `LIR`, etc.); this plan uses MIR terminology. The rename is step 1 so subsequent work uses consistent MIR naming.

1. **Rename LIR → MIR**: Rename `lir.ts` to `mir.ts`; update imports (e.g. `./lir` → `./mir`), variable names (`LIR` → `MIR`), comments, and MIR-LOWERING.md to use MIR terminology consistently
2. **Documentation**: Update MIR-LOWERING.md (§3.4 Call, closure layout, spine note); add lowering vision to ROADMAP or new LOWERING-VISION.md
3. **MIR**: Add `Call` with `CallTarget` (direct | indirect); add `Expr.FuncRef`; closure = Record; extend `pretty.ts`
4. **Context/Result**: Extend `LowerResult` with `functions`; add `nextFuncName` to ctx; extend `resetSupply()` to reset func-name counter. **Do NOT** call resetSupply in lowerToMir; document supply convention.
5. **Lambda**: Closure conversion with nested support; `freeVars` utility; closed-lambda handling (including empty env allocation)
6. **App**: Lower `App(f, arg)` — Phase 1 all calls are closure (inline lambda or param)
7. **lowerToMir → Module**: Collect functions, return `Module`; update callers (tests) to use `display.module(mod)` and snapshot full module
8. **Tests**: Lambda, nested lambda, closure call; switch to Module, use `display.module`; update snapshots

---

## 10. Pattern Match Order in `lower.ts`

- `App` after StructApp and primitive check
- For `App(k, v)` where k is continuation: check `ctx.continuation` first
- `Abs` with Lambda binding: add before `otherwise`

---

## 11. Documentation Update Steps

- **[MIR-LOWERING.md](docs/MIR-LOWERING.md)**: Add Call target union (replace old `Call func: string` with `CallTarget`); closure layout (`{ __fn, __env }`) as regular Record (no special allocation); Update modes `immutable` and `fbip` (align with current implementation); note spine future; align with "avoid CPS if possible"
- **[ROADMAP.md](brainstorming/yap/ROADMAP.md)** or new **LOWERING-VISION.md**: Add section on lowering/compilation strategy (fnptr + env, shift/reset state machine, spines, long-term goals from reference doc)
- **AGENTS.md** / **copilot-instructions.md**: Update if lowering entry points or conventions change

---

## 12. Gaps and Open Questions (Phase 1)

| Topic                        | Status             | Notes                                                                                                                  |
| ---------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Direct-call optimization** | Deferred           | Phase 1: all calls use indirect. Direct reserved for future top-level fn refs and closed-lambda optimization.          |
| **Closure field names**      | Fixed              | Use `__fn` and `__env`; closure = Record.                                                                              |
| **Pattern for Abs**          | Add to patterns.ts | Use `EB.CtorPatterns.Lambda` (`{ type: "Abs", binding: { type: "Lambda" } }`); verify destructuring in implementation. |
| **Alloc constructor**        | No change          | Closure = regular Record; use existing `Alloc(Record, fields, result)`. No special `Closure` variant.                  |
| **λx.x as whole term**       | Correct            | main allocates closure and returns it; no call. Cover in tests.                                                        |

---

## 13. Recursion (Out of Scope for Phase 1)

**Options for later** when we support `let rec` / fix / recursive closures:

| Option             | Description                                                                      | Tradeoffs                                                         |
| ------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Mutable cell**   | Env contains a mutable ref; closure writes itself into the cell after allocation | Simple; requires mutable allocation or indirection                |
| **Lambda lifting** | Lift recursive def to top-level; pass as extra param                             | No cyclic env; requires known call graph                          |
| **Backpatch**      | Allocate closure with placeholder; patch after creation                          | Common in implementations; requires mutable slot                  |
| **Y combinator**   | Encode recursion via fixpoint combinator                                         | No special support; but adds indirection and may complicate types |
| **Trampoline**     | Continuation-based; recursive calls become returns                               | Avoids stack growth; more complex control flow                    |

**Starting point**: Backpatch or mutable cell are typical for closure conversion of recursive bindings. Document when we add Block/Let.
