# MIR Design and Lowering Plan

> Machine-Independent IR for Yap. Design document for lowering EB.Term (and surface language) into a block-graph IR with explicit control flow.

> **Early draft.** None of this is final — the whole document is a work in progress. Structures, naming, and design decisions may change as we implement and learn.

---

## Table of Contents

1. [Context and Goals](#1-context-and-goals)
2. [Design Decisions](#2-design-decisions)
3. [MIR Structure (Data Stubs)](#3-mir-structure-data-stubs)
4. [Pipeline Overview](#4-pipeline-overview)
5. [Implementation Status](#5-implementation-status)
6. [EB.Term → MIR Mapping](#6-ebterm--mir-mapping)
7. [Shift/Reset Lowering (Detailed)](#7-shiftreset-lowering-detailed)
8. [Continuation Representation: Option A and Path to B](#8-continuation-representation-option-a-and-path-to-b)
9. [Out of Scope / Deferred](#9-out-of-scope--deferred)
10. [Open Questions](#10-open-questions)

---

## 1. Context and Goals

### 1.1 Where MIR Fits

Yap's pipeline today:

```
Source → Parse → Elaborate (EB.Term + NF) → Verify → Codegen (JS)
```

We introduce MIR as a stable intermediate representation between elaboration and backend code generation:

```
Source → Parse → Elaborate (EB.Term + NF) → Verify → Lower to MIR → [Optimize] → Backend
```

MIR serves as:

- **Optimization layer** — rewrite-friendly, explicit dataflow
- **Portable representation** — backend-neutral (JS, native, interpreter)
- **Target for lowering** — especially delimited continuations (shift/reset) without CPS

### 1.2 Why Lowering Matters

EB.Term is a high-level, tree-structured term language. It includes:

- `Reset` and `Shift` — delimited continuations
- `Lambda`, `App`, `Block`, `Match` — functional control flow
- `Modal` — refinement and multiplicity annotations

Backends (JS, native) expect:

- Explicit control flow (blocks, jumps, branches)
- No first-class continuations (unless we add runtime support)

Lowering bridges this gap. Delimited continuations are lowered to a **state machine** expressed with blocks and jumps, avoiding global CPS.

### 1.3 Design Principles

- **Preserve Yap semantics** — immutable structural sharing; FBIP (mutation when multiplicity allows)
- **Explicit control flow** — CFG with blocks and terminators
- **Avoid CPS** — shift/reset become explicit state machines
- **Rewrite-friendly** — SSA discipline, explicit bindings
- **Backend-neutral** — MIR encodes semantics; backend compiles as-is

---

## 2. Design Decisions

### 2.1 SSA with Block Parameters (No φ Nodes)

**Decision:** Use block parameters instead of φ instructions for merge points.

**Rationale:** Block parameters are explicit merge binders. Each predecessor passes values via `jump B(args)`. The block defines the binding site. This matches MLIR, Swift SIL, Rust MIR.

**Example:**

```
// Classical SSA: x3 = φ(x1, x2)
// MIR form:
block merge(x):
    return x

// Predecessors:
jump merge(x1)
jump merge(x2)
```

### 2.2 Reject CPS

**Decision:** Do not use CPS as the global IR.

**Rationale:** CPS forces continuation passing everywhere, obscures direct-style reasoning, complicates backend lowering, and adds administrative redex overhead. Delimited continuations are lowered to explicit state machines instead.

### 2.3 Immutable Bindings (with FBIP Exception)

**Decision:** No `Assign` for general mutation; only `Let` for bindings. Exception: when multiplicity allows (FBIP), MIR encodes in-place mutation via `Update` with mode `mutate`.

**Rationale:** Yap is functional with structural sharing. Multiplicities track when mutation is allowed. MIR must encode these semantics so the backend compiles them correctly without extra analysis. See [§6.4](#64-structural-operations-read-and-update-crud).

### 2.4 Block Parameters for Jump Targets

**Decision:** When control transfers to a block via `jump`, the target block receives arguments as parameters.

**Rationale:** Enables passing the resume value into continuation blocks. `jump cont_block(v)` binds `v` in the continuation block. No need for a separate "result" slot.

### 2.5 Continuations: Heap-Allocated Frame, Compile-Time Block (Option A)

**Decision:** Initial implementation heap-allocates the captured frame for multi-shot. The continuation block label is a compile-time constant. `k` is a heap ref `(L_cont, frame)`; `k(v)` becomes `Resume(k_ref, v)`.

**Rationale:** Multi-shot requires frame capture. Heap allocation is the simplest correct approach. We can optimize single-shot (stack allocation, direct jump) later. See [§8](#8-continuation-representation-option-a-and-path-to-b) for the path to Option B.

---

## 3. MIR Structure (Data Stubs)

### 3.1 Top-Level

```ts
// MIR module: a collection of functions
type Module = {
	functions: Function[];
};

type Function = {
	name: string;
	params: string[];
	entry: Label;
	blocks: Block[];
};
```

### 3.2 Blocks

```ts
type Block = {
	label: Label;
	params: string[]; // SSA binders; receive values from jump/branch
	instrs: Instr[];
	terminator: Terminator;
};

type Label = string;
```

### 3.3 Values and References

Values in MIR are **references** (locations/pointers). Yap owns the semantics of refs and boxed values. We introduce a low-level **location** type: a generic pointer to heap- or stack-allocated storage. The backend maps this to machine pointers.

### 3.4 Instructions (Pure, Value-Producing)

```ts
type CallTarget =
	| { type: "direct"; func: string } // compile-time known function name (reserved for future top-level fn refs)
	| { type: "indirect"; callee: string }; // SSA var holding fn ptr (from closure or param)

type Instr =
	| { type: "Let"; name: string; expr: Expr } // immutable binding
	// CRUD-style structural operations
	| { type: "Read"; label: string; target: string; result: string }
	| { type: "Update"; mode: "immutable"; into: string; result: string; alloc: Allocation }
	| { type: "Update"; mode: "fbip"; into: string; updates: Array<{ label: string; value: string }> }
	| { type: "Alloc"; alloc: Allocation; result: string } // allocate new storage (standalone)
	| { type: "Call"; target: CallTarget; args: string[]; result: string }
	| { type: "PrimOp"; op: string; args: string[] } // result via Let
	// Shift/reset: frame capture (heap-allocated for first iteration)
	| { type: "MakeCont"; block: Label; captured: string[]; result: string };
// ... other pure operations as needed
```

**Read** — Always a read; no mutability. Projects a field from a struct/record.

**Update** — Discriminated union on `mode`; aligns with current implementation:

- **`mode: "immutable"`** — Has `result` and `alloc`. Allocates a new record: the updated field(s) plus a ref to `into` for unchanged parts. Does _not_ copy the whole value; allocates the delta and shares the rest (immutable structural sharing).

- **`mode: "fbip"`** — Functional but in-place. Mutates `into` when multiplicity allows. No `result`; the instruction produces `into` (same ref).

**Call** — Single instruction with discriminated union target. **direct**: `Call({ type: "direct", func: "foo" }, ["a", "b"], "r")` → call `foo(a, b)` directly (reserved for future top-level fn refs). **indirect**: `Call({ type: "indirect", callee: "fnVar" }, [envVar, ...args], "r")` → call through fnVar. Phase 1 uses indirect only. Closure calls expand to Read `__fn`, `__env`, then `Call(indirect, fnVar, [envVar, ...args])`.

### 3.5 Expressions (Referenced in Instructions)

```ts
type Expr =
	| { type: "Var"; name: string }
	| { type: "Lit"; value: Literal }
	| { type: "FuncRef"; name: string } // function reference; used in closure allocation
	| { type: "PrimOp"; op: string; args: string[] }
	| { type: "Construct"; tag: string; args: string[] };
// ...

type Allocation = { type: "Record"; fields: Array<{ label: string; value: string }> };
```

### 3.6 Closure Layout (Func Ptr + Env Record)

Closures use a **function pointer + environment record** layout. No special allocation:

- **Closure** = regular Record with `__fn` (FuncRef) and `__env` (env record ref).
- **Expr.FuncRef(name)** — binds a function reference; used in `Let fn = FuncRef("f_0")`.
- **Closure creation** — `AllocRecord([{ __fn, fn }, { __env, envRef }], result)`.
- **Closure call** — Expand to Read `__fn`, Read `__env`, then `Call(indirect, fnVar, [envVar, ...args])`. Backend sees plain Read + Call; no special closure handling.

This layout is portable, debuggable, and C-friendly. **Spine note:** Spines (multi-arg, explicit arity) are planned; the closure layout accommodates evolution without fundamental redesign.

### 3.7 Terminators

```ts
type Terminator =
	| { type: "Jump"; target: Label; args: Expr[] }
	| { type: "Branch"; cond: string; thenTarget: Label; thenArgs: Expr[]; elseTarget: Label; elseArgs: Expr[] }
	| { type: "Switch"; scrutinee: string; cases: Array<{ tag: string; target: Label; args: Expr[] }>; default?: { target: Label; args: Expr[] } }
	| { type: "Return"; value: string }
	| { type: "Resume"; cont: string; value: string }; // restore cont's frame, jump to cont's block with value
```

Each block ends with exactly one terminator. No fallthrough.

### 3.8 Design Note: Assign vs Let

MIR uses `Let` for immutable bindings (replacing the earlier `Assign`). Each `Let` introduces a new SSA value. This aligns with Yap's functional semantics and simplifies reasoning about dataflow.

---

## 4. Pipeline Overview

```
EB.Term (zonked, solved)
    │
    ▼
[ANF Normalization]  (optional; makes evaluation order explicit)
    │
    ▼
[Lower to MIR]  (single pass)
    │  - Closure conversion (lambdas → functions + explicit env)
    │  - Flatten blocks, match, etc. into CFG
    │  - Lower shift/reset to state machine (frame capture, heap-alloc)
    │  - Lower Proj/Inj to READ/UPDATE with multiplicity-derived mode (FBIP)
    │
    ▼
MIR (Function with blocks)
    │
    ▼
[Optimization Passes] (future)
    │
    ▼
[Backend Lowering] (JS, native, interpreter — out of scope for this doc)
```

**Closure conversion** is part of the lowering pass. When we lower a lambda, we either: (a) convert it to a top-level function with an explicit environment parameter (if it escapes), or (b) inline it (if it doesn't). This keeps the pipeline simple — one lowering pass that produces MIR. Whether this is tricky depends on the lambda structure; we integrate it and iterate.

**Phase 1:** Implement core lowering including closure conversion for non-nested lambdas. Lower a subset of EB.Term (literals, vars, app, let, block, reset, shift, resume, proj→Read, inj→Update) to MIR.

---

## 5. Implementation Status

> Last updated: 2026-02-26

The lowering pass lives in `src/lowering/`. The MIR types (Module, Function, Block, Instr, Terminator, Expr, Allocation) are defined in `mir.ts` — Let, Var, Lit, PrimOp; Read, Update (immutable/fbip), Alloc; Jump, Branch, Return. A pretty printer (`pretty.ts`) provides `display.expr`, `display.instr`, etc., with pattern-matched polymorphic dispatch.

### Implemented

| EB.Term / Feature  | Status | Notes                                                                   |
| ------------------ | ------ | ----------------------------------------------------------------------- |
| `Lit`              | ✅     | Num, Bool, String, etc. → `Let x = Lit(v); Return x`                    |
| `Var(Bound)`       | ✅     | Resolved via `LowerCtx.bound` map                                       |
| `Var(Free)`        | ✅     | Resolved via `LowerCtx.free` map                                        |
| `Var(Foreign)`     | ✅     | As prim op arg only; throws if used as value                            |
| Primitive `App`    | ✅     | Curried apps (`add(1, 2)`, `not(true)`) → `Let` + `PrimOp` + `Return`   |
| `App(Struct, Row)` | ✅     | Record construction → `Alloc` with fields                               |
| `Proj`             | ✅     | From Struct only → `Read(label, target, result)`                        |
| `Inj`              | ✅     | From Struct only → `Update` (immutable mode); type-level base → erasure |

Supported primops: `$add`, `$sub`, `$mul`, `$div`, `$and`, `$or`, `$eq`, `$neq`, `$lt`, `$gt`, `$lte`, `$gte`, `$mod`, `$concat`, `$not`.

### Not Yet Implemented

| EB.Term / Feature | Status | Notes                                    |
| ----------------- | ------ | ---------------------------------------- |
| `Lambda`          | ❌     | Throws "not implemented"                 |
| `App` (general)   | ❌     | Only primitive apps and Struct supported |
| `Block`           | ❌     | —                                        |
| `Match`           | ❌     | —                                        |
| `Reset` / `Shift` | ❌     | —                                        |
| `Let`             | ❌     | —                                        |

### Tests

- `src/lowering/__tests__/lower.test.ts` — Lit, Var, prim App, struct, proj, inj, Lambda/Foreign throw
- `src/lowering/__tests__/pretty.test.ts` — Pretty printer unit tests and snapshots (incl. Read, Alloc, Update)

### Supply convention

Lowering follows the same convention as other passes: supplies are global; passes do NOT reset. See `docs/ARCHITECTURE.md` § Supply and naming.

---

## 6. EB.Term → MIR Mapping

### 6.1 Source Language Context

EB.Term constructors (from `src/elaboration/syntax/term.ts`):

| EB.Term                            | Description             |
| ---------------------------------- | ----------------------- |
| `Lit`, `Var`                       | Values                  |
| `Abs` (Lambda, Pi, Let, Mu, Sigma) | Bindings                |
| `App`                              | Application             |
| `Row`, `Proj`, `Inj`               | Structural types        |
| `Match`                            | Pattern matching        |
| `Block`                            | Statement sequences     |
| `Modal`                            | Modality annotations    |
| `Reset`, `Shift`                   | Delimited continuations |

### 6.2 Conceptual Mappings (Not Exhaustive)

**Literals and Variables**

```
EB.Lit(v)        →  Let x = Lit(v); ... (x in scope)
EB.Var(Bound i)  →  Var (from env/params)
EB.Var(Free n)   →  Var (from module scope)
```

**Application**

```
EB.App(icit, f, arg)
  →  Let arg_val = lower(arg);
      Let result = Call(lower(f), [arg_val]);
      ... (result in scope)
```

**Block**

```
EB.Block(statements, return)
  →  For each Let stmt: Let x = lower(value);
      lower(return) with extended env
```

**Lambda** (closure conversion as part of lowering)

```
EB.Abs(Lambda, x, body)
  →  If escaping: new top-level function with params [env, x]; body = lower(body) with env for free vars
  →  If not escaping: inline or lower as block with x param
```

**Match**

```
EB.Match(scrutinee, alternatives)
  →  Let s = lower(scrutinee);
      Switch(s) with cases per alternative
      Each case: lower(pattern bindings), jump to block that lowers(term)
```

**Modal**

```
EB.Modal(term, { quantity, liquid })
  →  lower(term)  // liquid used in verification; quantity flows to structural ops (FBIP)
```

### 6.4 Structural Operations: READ and UPDATE (CRUD)

Yap uses **immutable structural sharing** by default. Multiplicities allow **FBIP** (functional but in-place): when we have exclusive/linear access, mutation is permitted. This is **Yap semantics**, not a backend choice.

**CRUD naming:** We use READ (projection) and UPDATE (injection) instead of Project/Inject. Only UPDATE needs mutability; READ is always a read.

**Record update** lowers to one of:

1. **`Update { mode: "immutable"; into; result; alloc }`** — Allocate the new record: updated field(s) plus ref to `into` for unchanged parts. `result` is the new allocation.

2. **`Update { mode: "fbip"; into; updates }`** — Mutate `into` in place (FBIP). No `result`; the instruction produces `into` (same ref).

**Lowering:** `EB.Proj(label, term)` → `Read(label, target, result)`. `EB.Inj(label, value, term)` → `Update` with `mode` from multiplicity: `immutable` or `fbip`.

**Allocation:** `Alloc` allocates new storage (records, variants, etc.). Used when constructing values and for the allocate-mode update.

**Variants:** Variants are structs with a tag and payload. Injection on variants is type-level; the runtime representation is a struct. TODO/QUESTION: Do we need to support injection on variants in MIR, or can we defer? The representation may be straightforward; the semantics need clarification.

### 6.5 Reset and Shift (High-Level)

```
EB.Reset(term)
  →  Create reset_entry, reset_exit blocks
  →  lower(term) in context { exit: reset_exit }
  →  Result flows to reset_exit

EB.Shift(body)   // body = Lambda(k, e) with k = continuation
  →  Create L_cont (continuation block), capture frame (live vars)
  →  MakeCont(L_cont, captured) → k_ref; jump shift_body(k_ref)
  →  lower(e) with k = k_ref; App(k, v) in e becomes Resume(k_ref, v)
```

See [§7](#7-shiftreset-lowering-detailed) for the detailed transformation.

---

## 7. Shift/Reset Lowering (Detailed)

### 7.1 EB.Term Structure

From elaboration:

- **Reset(term):** `term` is the body of the reset. It may contain `Shift` and `App(k, v)` (resume).
- **Shift(body):** `body` is `Lambda(k, e)` where `k` is the continuation (type `A → α`). The body `e` is checked with `k` in scope. `resume v` in source becomes `App(k, v)` in EB.Term.
- **Resume:** In EB.Term, resume is `App(k, v)` where `k` is the continuation binder (Bound index) and `v` is the value.

### 7.2 Continuation as Block + Frame

The continuation is the "rest of the reset" from the shift point to the reset boundary. We represent it as:

- A **block** with one parameter (the resume value)
- A **frame** (captured live variables) — heap-allocated for multi-shot

When the shift body calls `k(v)`, we emit `Resume(k_ref, v)`, which restores the frame and jumps to the continuation block with `v`.

### 7.3 Transformation: Single Shift

**Source (conceptual):**

```yap
reset {
  e1;
  shift (\k -> e2);   // e2 may call k(v) or return normally
  e3
}
```

**MIR structure (with heap-allocated frame for multi-shot):**

```
block reset_entry():
    // lower e1
    // Capture live vars into frame; MakeCont(L_cont, [v1, v2, ...]) → k_ref
    jump shift_body(k_ref)

block shift_body(k_ref):     // k_ref = heap-allocated continuation (block + frame)
    // lower e2; k(v) → Resume(k_ref, v)
    // terminator: Resume(k_ref, v) or jump reset_exit(result)

block L_cont(v):             // continuation block: "rest of reset"
    // lower e3 (frame was restored by Resume)
    jump reset_exit(result)

block reset_exit(result):
    // caller continues from here
```

**Key points:**

- For multi-shot we heap-allocate. Before jumping to the shift body, we emit `MakeCont(L_cont, captured_vars)` to allocate the continuation. The shift body receives `k_ref`.
- `k(v)` becomes `Resume(k_ref, v)` — a terminator that restores the frame and jumps to `L_cont` with `v`.
- For Option A (non-escaping), we could optimize to direct `jump L_cont(v)` when we know single-shot — but first iteration we always use the heap-allocated path.

### 7.4 Transformation: Nested Shifts

```
reset {
  e1;
  shift (\k1 -> e2);
  e3;
  shift (\k2 -> e4);
  e5
}
```

- First shift: continuation = `e3; shift (\k2 -> e4); e5`
- Second shift: continuation = `e5`

Each shift gets its own continuation block and frame capture. The structure is recursive:

```
block reset_entry():
    ... lower e1 ...
    k1_ref = MakeCont(L_cont_1, captured_1)
    jump shift_body_1(k1_ref)

block shift_body_1(k1_ref):
    ... lower e2, k1(v) → Resume(k1_ref, v) ...
    // exits: Resume(k1_ref, v) or jump reset_exit(r)

block L_cont_1(v):
    ... lower e3 ...
    k2_ref = MakeCont(L_cont_2, captured_2)
    jump shift_body_2(k2_ref)

block shift_body_2(k2_ref):
    ... lower e4, k2(v) → Resume(k2_ref, v) ...
    // exits: Resume(k2_ref, v) or jump reset_exit(r)

block L_cont_2(v):
    ... lower e5 ...
    jump reset_exit(result)

block reset_exit(result):
    ...
```

### 7.5 Shift That Returns Without Resuming

```
reset { shift (\k -> 42) }
```

- Shift body returns 42.
- Emit `jump reset_exit(42)`.
- The continuation block is dead (never jumped to).

### 7.6 Multi-Shot Semantics and Frame Capture

**Multi-shot:** A continuation `k` can be resumed multiple times. Each `k(v)` runs the continuation from the shift point with that value. The continuation must be **replayable** — its captured state cannot be consumed on first use.

**Single-shot vs multi-shot:** For single-shot (linear) `k`, we could theoretically use stack allocation — but we simplify the first iteration by **heap-allocating all continuations**. This correctly handles multi-shot and defers optimization of linear continuations.

**Frame capture:** When we shift, we capture:

- The **continuation** — the code from the shift point to the reset boundary (a block)
- The **frame/state** — the environment (live variables, stack frames) at the shift point

For multi-shot, each resume must be able to replay the continuation with a fresh copy of the state (or the state must be immutable). First iteration: **heap-allocate the captured frame**. The continuation is a heap object containing:

- A reference to the continuation block (code)
- The captured environment (live vars, any nested frames)

**MIR representation:** We introduce a `Continuation` value kind (or a `MakeCont` instruction) that heap-allocates the captured state. `resume` becomes: load the continuation, restore its frame, `jump` to its block with the value. The lowering pass emits `MakeCont(L_cont, captured_vars)` when creating the continuation, and `Resume(cont_ref, v)` when the shift body calls `k(v)`. For Option A (non-escaping), we can still use direct `jump L_cont(v)` when `k` doesn't escape — but to support multi-shot we need the frame capture. So even in Option A, we heap-allocate the frame; the difference is whether `k` is a label (direct jump) or a value (indirect jump).

**Simplified first iteration:** Always heap-allocate. `k` is a heap-allocated continuation. `k(v)` = load continuation, restore frame, jump to its block with `v`. This correctly implements multi-shot. We can optimize single-shot later (e.g. stack allocation, or direct jump when we know `k` is used once and doesn't escape).

### 7.7 Lowering Algorithm Sketch

```
lowerReset(term, ctx):
  reset_exit = freshLabel()
  ctx' = ctx ∪ { resetExit: reset_exit }
  lowerInReset(term, ctx')  // returns (entryBlock, blocks)

lowerInReset(term, ctx):
  case term of
    Shift(Lambda(k, e)):
      L_cont = freshLabel()
      // Capture live vars for frame; emit MakeCont(L_cont, captured) before jump to body
      contBlocks = lowerInReset(restOfReset, ctx)
      bodyBlocks = lower(e, ctx ∪ { k: (L_cont, frame) })   // k(v) → Resume(k_ref, v)
      ...
    App(k, v) when k is continuation:
      emit Resume(k_ref, lower(v))
    ...
```

### 7.8 Identifying the Continuation

The continuation is the "rest of the reset" from the shift point to the reset boundary. We extract it by **traversing the term and passing the context** (what would run after the current subterm) as we go. When we hit a Shift, we turn that context into a block. No CPS IR needed — just context-passing in the lowering traversal.

**Example:** `reset (f (shift (\k -> e)))` — the continuation is `\v -> f(v)`. As we traverse, we have context `f([])`. At the shift, we create a block that receives `v` and computes `f(v)`. The lowering algorithm passes this context through the traversal.

**Simpler case:** `reset (Block [e1, shift body, e3])` — the continuation is `e3`. For Block, we identify: statements before shift, the shift, statements after shift. The "rest" is explicit.

**Deferred:** Full treatment of arbitrary shift placement. Phase 1 can focus on reset bodies that are Blocks with at most one shift, or a simple structural form.

---

## 8. Continuation Representation: Option A and Path to B

### 7.1 Option A (Current)

- **Continuation** = heap-allocated object `(block_label, frame)`. The block label is a compile-time constant.
- **MakeCont** allocates; **Resume** restores frame and jumps to the block.
- **k** is passed to the shift body as a value (the heap ref). The block label inside it is fixed.

**Limitation:** `k` cannot escape. If the shift body stores `k` or passes it to a function that uses it later, we have no way to represent that — the continuation object is tied to this reset's scope. Escape analysis is deferred; we assume `k` does not escape.

### 7.2 Path to Option B

To support escaping continuations:

1. **Block references as first-class values** — the continuation can hold a block chosen at runtime.
2. **Indirect jump** — `Resume` (or a variant) can jump to a block whose identity is stored in the continuation, not fixed at compile time.
3. **Backend mapping** — escaping continuations become trampoline closures or code pointers.

**Migration:** The lowering pass can be parameterized. Option A: continuation = `(L_cont, frame)` with fixed `L_cont`. Option B: continuation = `(block_ref, frame)` where `block_ref` can be any block. The rest of the lowering stays the same.

---

## 9. Out of Scope / Deferred

| Item                                               | Reason                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Escape analysis for k**                          | Reduces scope; can be added later. Escaping `k` will be incorrect until then.                                  |
| **Type system changes for linearity**              | Type system works as-is. Lowering assumes correct usage; we can test linear vs multishot without type changes. |
| **ANF normalization**                              | Can be added as a phase; not required for initial lowering.                                                    |
| **Full pattern matching**                          | Match lowering is complex; can start with simplified forms.                                                    |
| **Optimization passes**                            | Dead block elimination, inlining, etc. — future work.                                                          |
| **Backend lowering (JS, native)**                  | MIR is the target; backend is separate.                                                                        |
| **First-class block refs (Option B)**              | Documented as future work.                                                                                     |
| **Stack allocation for single-shot continuations** | First iteration heap-allocates; optimize later.                                                                |
| **Variant injection in MIR**                       | TODO/QUESTION: Defer until semantics are clearer.                                                              |

---

## 10. Open Questions

1. **Block parameters and merge points:** We explicitly avoid φ nodes. Block parameters receive values from jumps; each predecessor passes its args via `jump B(args)`. Multiple predecessors → multiple jump sites to the same block, each passing (possibly different) args. The block's params are the merge — no φ needed. Open: do we need to formalize the "which predecessor" mapping, or is the current model sufficient?

2. **Closure conversion complexity:** Integrated into lowering. Open: how complex for nested lambdas, mutually recursive closures, etc.? We'll discover as we implement.

3. **Naming:** LIR → MIR rename completed. MIR types are defined in `src/lowering/mir.ts`.

4. **AllocShape:** What allocation shapes do we need? Records, variants, continuations, ...? Refine as we implement.

---

## Appendix: MIR Spec Alignment

This document adapts the MIR spec (SSA with block parameters, no CPS, no φ) to Yap:

- **Functions** — Top-level units; one function per top-level definition (or similar).
- **Blocks** — `label`, `params`, `instrs`, `terminator`.
- **Values** — References (locations/pointers); Yap owns ref semantics.
- **Instructions** — Pure. `Let` for bindings. `Read` (always read). `Update` discriminated on `mode`: `immutable` (has `result`, `alloc`) or `fbip` (no `result`, produces `into`). `Alloc` for standalone allocation. `Call` with `CallTarget` (direct | indirect). `MakeCont` for frame capture.
- **Terminators** — `Jump`, `Branch`, `Switch`, `Return`, `Resume`.
- **Shift/reset** — State machine via blocks and jumps; heap-allocated frame capture for multi-shot; Option A (compile-time block label) with path to Option B.
