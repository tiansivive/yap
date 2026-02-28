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
   - [9.1 Functional Patterns (Curry-style)](#91-functional-patterns-curry-style)
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

### 2.5 Continuations: Heap-Allocated Frame, No Special MIR Instructions (Option A)

**Decision:** Continuation = heap-allocated record with `__env` field (closure convention). No special MIR instructions. Creation: `Alloc`. Invocation: `Read(__env)` + `Jump`. The block label is a compile-time constant.

**Rationale:** Multi-shot requires frame capture. Heap allocation is the simplest correct approach. Using only existing Alloc, Read, Jump keeps MIR minimal. We can optimize single-shot (stack allocation, direct jump) later. See [§8](#8-continuation-representation-option-a-and-path-to-b) for the path to Option B.

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
	| { type: "PrimOp"; op: string; args: string[] }; // result via Let
// ... other pure operations as needed
```

**Shift/reset:** Uses only `Alloc`, `Read`, `Jump`. No dedicated continuation instructions. Continuation = `Alloc { __env: envRef }`; resume = `Read("__env", k_ref, envRef)` then `Jump L_cont(v, envRef)`.

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

Branch uses **switch semantics** (multi-way dispatch). No separate Switch terminator.

```ts
type Terminator =
	| { type: "Jump"; target: Label; args: string[] }
	| { type: "Branch"; scrutinee: string; cases: Array<{ value: string; target: Label; args: string[] }>; default?: { target: Label; args: string[] } }
	| { type: "Return"; value: string };
```

- **Branch**: `scrutinee` = SSA var; `cases` = `{ value, target, args }` (value = tag name or literal); `default` = failure path (e.g. non-exhaustive match).

**Resume:** Lowered to `Read` + `Jump`; no Resume terminator. When the shift body calls `k(v)`, we emit `Read("__env", k_ref, envRef)` then `Jump L_cont(v, envRef)`.

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
MIR (Module with functions)
    │
    ▼
[Optimization Passes] (future)
    │
    ▼
[Backend Lowering] (JS, native, interpreter — out of scope for this doc)
```

**Closure conversion** is part of the lowering pass. Lambdas are always closure-converted (Phase 1: no escape analysis). Each lambda becomes a top-level function with params `[env, x]` and an explicit env record. `lowerToMir` returns a `Module` with `main` plus all lifted functions.

**Phase 1 (implemented):** Lit, Var, prim App, Struct/Proj/Inj, Lambda (nested supported), App (indirect calls), Match. Shift/Reset (Alloc + Read + Jump, no MakeCont/Resume). Not yet: Block, Let.

---

## 5. Implementation Status

> Last updated: 2026-02-27

The lowering pass lives in `src/lowering/`. The MIR types (Module, Function, Block, Instr, Terminator, Expr, Allocation) are defined in `mir.ts` — Let, Var, Lit, PrimOp, FuncRef; Read, Update (immutable/fbip), Alloc; Call (direct/indirect); Jump, Branch, Return. A pretty printer (`pretty.ts`) provides `display.expr`, `display.instr`, `display.module`, etc.

### Implemented

| EB.Term / Feature  | Status | Notes                                                                   |
| ------------------ | ------ | ----------------------------------------------------------------------- |
| `Lit`              | ✅     | Num, Bool, String, etc. → `Let x = Lit(v); Return x`                    |
| `Var(Bound)`       | ✅     | Resolved via `LowerCtx.bound` map                                       |
| `Var(Free)`        | ✅     | Resolved via `LowerCtx.free` map                                        |
| `Var(Foreign)`     | ✅     | As prim op arg only; throws if used as value                            |
| Primitive `App`    | ✅     | Curried apps (`add(1, 2)`, `not(true)`) → `Let` + `PrimOp` + `Return`   |
| `App(Struct, Row)` | ✅     | Record construction → `Alloc` with fields                               |
| `App` (general)    | ✅     | Read `__fn`/`__env`, `Call(indirect, fnVar, [envVar, arg])`             |
| `Lambda`           | ✅     | Closure conversion; nested supported; uniform `(env, x)` params         |
| `Proj`             | ✅     | From Struct only → `Read(label, target, result)`                        |
| `Inj`              | ✅     | From Struct only → `Update` (immutable mode); type-level base → erasure |

Supported primops: `$add`, `$sub`, `$mul`, `$div`, `$and`, `$or`, `$eq`, `$neq`, `$lt`, `$gt`, `$lte`, `$gte`, `$mod`, `$concat`, `$not`.

**Closure layout:** `{ __fn: FuncRef, __env: record }`. Uniform calling convention: all closure-called functions take `(env, x)`; caller always passes `[envVar, arg]`.

**lowerToMir** returns `Module` with `[main, ...functions]` (lifted closure bodies included).

### Match (Phase 1)

| EB.Term / Feature | Status | Notes                                                                                                                                                                                                                                            |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Match`           | ✅     | Decision-tree compilation (Maranget-style). Variant, Lit, Struct, Binder, Wildcard. Branch = switch form. Merge via block params. Failure block. List pattern not yet implemented. See plan `.cursor/plans/match_expression_lowering_*.plan.md`. |

### Not Yet Implemented

| EB.Term / Feature | Status | Notes                                                           |
| ----------------- | ------ | --------------------------------------------------------------- |
| `Block`           | ❌     | —                                                               |
| `Reset` / `Shift` | ✅     | Alloc + Read + Jump; see `src/lowering/delimited_continuation/` |
| `Let`             | ❌     | —                                                               |

### Tests

- `src/lowering/__tests__/lower.test.ts` — Lit, Var, prim App, struct, proj, inj, Lambda, App (indirect, curried), closure with capture; uses `display.module(mod)` for snapshots
- `src/lowering/__tests__/pretty.test.ts` — Pretty printer unit tests and snapshots (incl. Read, Alloc, Update, Call, display.module)

### Supply convention

Lowering follows the same convention as other passes: supplies are global; passes do NOT reset. `lowerToMir` does NOT call `resetSupply()`; callers (e.g. tests) must call it for deterministic names (vars, labels, func names like `f_0`, `f_1`). See `docs/ARCHITECTURE.md` § Supply and naming.

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
  →  Top-level function with params [env, x]; body = lower(body) with env for free vars
  →  Alloc env record with captured values; Alloc closure { __fn: FuncRef(name), __env: envRef }
  →  Phase 1: always closure-convert (no escape analysis). Uniform calling convention: all lambdas take (env, x).
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
  →  lowerInReset(term) in context { resetExit }
  →  Result flows to reset_exit

EB.Shift(body)   // body = Lambda(k, e)
  →  Alloc { __env: envRef } → k_ref  (envRef = Alloc { v0, v1, ... } with captured)
  →  Jump shift_body(k_ref)
  →  k(v) in body → Read("__env", k_ref, envRef); Jump L_cont(v, envRef)
```

See [§7](#7-shiftreset-lowering-detailed) for the detailed transformation.

---

## 7. Shift/Reset Lowering (Detailed)

### 7.1 EB.Term Structure

From elaboration:

- **Reset(term):** `term` is the body of the reset. It may contain `Shift` and `App(k, v)` (resume).
- **Shift(body):** `body` is `Lambda(k, e)` where `k` is the continuation (type `A → α`). The body `e` is checked with `k` in scope. `resume v` in source becomes `App(k, v)` in EB.Term.
- **Resume:** In EB.Term, resume is `App(k, v)` where `k` is the continuation binder (Bound index) and `v` is the value. There is no separate `EB.Resume` constructor.

### 7.2 Continuation Layout (Closure Convention)

Continuation = heap-allocated record with single `__env` field. The env record holds captured vars as `v0`, `v1`, ... (same convention as closures).

```
k_ref = Alloc { __env: envRef }
envRef = Alloc { v0: x0, v1: x1, ... }  // captured vars

Resume: Read("__env", k_ref, envRef)
        Jump L_cont(v, envRef)

Block L_cont(v, envRef):
  Read("v0", envRef, t0)
  Read("v1", envRef, t1)
  ...
  // rest of reset body, with t0, t1, ... in scope
  Jump reset_exit(result)
```

**Frame replay:** The `Read` + `Jump` sequence is the lowering equivalent of frame replay. We restore captured state (env record) and transfer control to the continuation block. The continuation block executes the rest of the reset body — semantically equivalent to replaying the captured frames with the resumed value.

**Continuation body scope:** The continuation body's scope depends on how the shift appears:

- **Shift as statement** (`shift k -> e; rest`): The continuation body has only block bindings (env captures). The resumption value `v` is passed to `L_cont` but the body may ignore it. To use the resumption value, the user must explicitly bind it.
- **Shift in Let RHS** (`let v = shift k -> e; rest`): The Let variable `v` is the resumption binder. The continuation body has `v` at index 0 and block bindings at 1+. The body may use both.

### 7.3 Transformation: Single Shift

**Source (conceptual):**

```yap
reset {
  e1;
  shift (\k -> e2);   // e2 may call k(v) or return normally
  e3
}
```

**MIR structure (Alloc + Read + Jump only):**

```
block reset_entry():
    // lower e1
    envRef = Alloc { v0: x0, v1: x1, ... }   // captured live vars
    k_ref = Alloc { __env: envRef }
    jump shift_body(k_ref)

block shift_body(k_ref):
    // lower e2; k(v) → Read("__env", k_ref, envRef); Jump L_cont(v, envRef)
    // terminator: Jump L_cont(v, envRef) or jump reset_exit(result)

block L_cont(v, envRef):
    Read("v0", envRef, t0)
    Read("v1", envRef, t1)
    ...
    // lower e3 with t0, t1, ... in scope
    jump reset_exit(result)

block reset_exit(result):
    // caller continues from here
```

**Key points:**

- No MakeCont or Resume. Continuation creation = `Alloc` env + `Alloc` k_ref with `__env`.
- `k(v)` = `Read("__env", k_ref, envRef)` then `Jump L_cont(v, envRef)` — this restores captured state and replays the continuation.

### 7.4 Transformation: Nested Shifts

Each shift gets its own continuation block and frame capture. Same pattern: `Alloc` env, `Alloc` k_ref, `Jump` shift_body; resume = `Read` + `Jump`.

### 7.5 Shift That Returns Without Resuming

```
reset { shift (\k -> 42) }
```

- Shift body returns 42.
- Emit `jump reset_exit(42)`.
- The continuation block is dead (never jumped to).

### 7.6 Multi-Shot Semantics

**Multi-shot:** A continuation `k` can be resumed multiple times. Each `k(v)` runs the continuation from the shift point with that value. We **always heap-allocate** for the first implementation; linear optimization (direct jump, stack allocation) is deferred.

### 7.7 Lowering Algorithm Sketch

```
lowerReset(term, ctx):
  reset_exit = freshLabel()
  ctx' = ctx ∪ { resetExit, resetCtx }
  lowerInReset(term, ctx')  // returns (entryBlock, blocks)

lowerInReset(term, ctx):
  case term of
    Shift(Lambda(k, e)):
      L_cont = freshLabel()
      captured = liveVars(restOfReset)
      envRef = Alloc { v0, v1, ... }(captured)
      k_ref = Alloc { __env: envRef }
      // k(v) in e → Read("__env", k_ref, envRef); Jump L_cont(v, envRef)
      ...
    App(k, v) when k is continuation:
      emit Read("__env", k_ref, envRef); Jump L_cont(lower(v), envRef)
    ...
```

### 7.8 Identifying the Continuation

The continuation is the "rest of the reset" from the shift point to the reset boundary. We extract it by **traversing the term and passing the context** (what would run after the current subterm) as we go. When we hit a Shift, we turn that context into a block. No CPS IR needed — just context-passing in the lowering traversal.

**Simpler case:** `reset (Block [e1, shift body, e3])` — the continuation is `e3`. For Block, we identify: statements before shift, the shift, statements after shift. The "rest" is explicit.

**Deferred:** Full treatment of arbitrary shift placement. Phase 1 can focus on reset bodies that are Blocks with at most one shift, or a simple structural form.

### 7.9 Elaboration Expectations and Gaps

| Expectation                                       | Current Elaboration               | Gap / Note                                                             |
| ------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `Reset(term)`                                     | Yes                               | —                                                                      |
| `Shift(body)` with `body = Lambda(k, e)`          | Yes (k = Continuation binder)     | —                                                                      |
| Resume = `App(k, v)` with k Bound to Continuation | Yes                               | —                                                                      |
| Block structure for "rest of reset"               | Block has statements + return     | Phase 1: focus on Block with at most one shift                         |
| Continuation binder identifiable                  | Binder type `Continuation` in env | Need to detect in lowering when App(func, arg) has func = continuation |
| Multiplicity on k                                 | Not tracked                       | Assume multi-shot; defer linear optimization                           |
| Shift outside Reset                               | Not supported                     | Lowering throws; see §7.10.1                                           |

**Note:** If elaboration does not output these structures, that is a problem for later. Lowering will throw or behave incorrectly; document and defer.

### 7.10.1 Shift Outside Reset

Terms like `\x -> shift k -> k 0` (shift inside a lambda, outside reset) are **not supported** by the current lowering. The effect system could type such terms (the function would carry a continuation effect; callers would need to handle it), but **lowering** requires an enclosing `Reset` to provide `reset_exit` and `resetCtx`. Without reset, the continuation would need to escape (Option B). For now, elaboration should reject or wrap such terms; lowering throws "Shift without enclosing reset".

### 7.10 State Machine: Block-Graph and Loop-Driven Forms

Shift/reset lowering produces a **state machine** expressed as a block-graph: each state is a block (reset_entry, shift_body, L_cont, reset_exit), and transitions are jumps. The CFG is the state machine.

An alternative compilation strategy is a **loop-driven** form:

```
entry:
  state = ENTER
  jump loop(state)

loop(s):
  branch s {
    ENTER -> ...   // run reset body until shift
    RESUME -> ...  // run continuation with resumed value
  }
```

Both forms are equivalent. MIR keeps the block-graph form (states = blocks, transitions = jumps). A backend may compile this as a loop+switch if desired — the block-graph is the canonical MIR representation; the loop form is a backend compilation option.

---

## 8. Continuation Representation: Option A and Path to B

### 8.1 Option A (Current)

- **Continuation** = `Alloc { __env: envRef }`. Block label is compile-time constant.
- **Creation:** `Alloc` env record, then `Alloc` k_ref with `__env`.
- **Resume** = `Read("__env", k_ref, envRef)` + `Jump L_cont(v, envRef)`.

**Limitation:** `k` cannot escape. If the shift body stores `k` or passes it to a function that uses it later, we have no way to represent that — the continuation object is tied to this reset's scope. Escape analysis is deferred; we assume `k` does not escape.

### 8.2 Path to Option B

To support escaping continuations:

1. **Block references as first-class values** — the continuation can hold a block chosen at runtime.
2. **Indirect jump** — jump to a block whose identity is stored in the continuation, not fixed at compile time.
3. **Backend mapping** — escaping continuations become trampoline closures or code pointers.

---

## 9. Out of Scope / Deferred

### 9.1 Functional Patterns (Curry-style)

**Yap does not support functional patterns yet.** In Curry, patterns can contain function symbols:

```curry
last (_++[e]) = e
```

- **Unification vs. pattern matching:** Functional patterns require runtime unification, not just deconstruction. The pattern `_++[e]` unifies scrutinee with (some list ++ [e]). Current match lowering uses decision-tree compilation (Maranget-style) — constructor deconstruction only.
- **Compilation:** Narrowing (unification + reduction); possibly backtracking. Cannot use pure decision trees. Residuation may be needed for non-deterministic or constraint-based matching.
- **Elaboration impact:** Elaboration would need significant changes. Pattern inference currently assumes constructor patterns (Lit, Struct, Variant, Binder, Wildcard). Functional patterns require:
  - Pattern type inference for patterns containing function symbols (unification of scrutinee with pattern shape).
  - Possibly nondeterministic or constraint-based elaboration (residuation, narrowing).
  - See `src/elaboration/inference.v2/match.ts`, `src/elaboration/checking.v2/match.ts`, and `docs/V2-MIGRATION.md` for current match handling.
- **References:** Curry tutorial §3.5.5; Hanus FLOPS 2002; narrowing machines. See also `docs/TODO.md` (Unification? Residuations?).

| Item                                               | Reason                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Functional patterns (Curry-style)**              | Requires runtime unification, narrowing, possibly residuation. Elaboration and lowering both need redesign. See §9.1. |
| **Escape analysis for k**                          | Reduces scope; can be added later. Escaping `k` will be incorrect until then.                                         |
| **Type system changes for linearity**              | Type system works as-is. Lowering assumes correct usage; we can test linear vs multishot without type changes.        |
| **ANF normalization**                              | Can be added as a phase; not required for initial lowering.                                                           |
| **Full pattern matching**                          | Match lowering is complex; can start with simplified forms.                                                           |
| **Optimization passes**                            | Dead block elimination, inlining, etc. — future work.                                                                 |
| **Backend lowering (JS, native)**                  | MIR is the target; backend is separate.                                                                               |
| **First-class block refs (Option B)**              | Documented as future work.                                                                                            |
| **Stack allocation for single-shot continuations** | First iteration heap-allocates; optimize later.                                                                       |
| **Variant injection in MIR**                       | TODO/QUESTION: Defer until semantics are clearer.                                                                     |

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
- **Instructions** — Pure. `Let` for bindings. `Read` (always read). `Update` discriminated on `mode`: `immutable` (has `result`, `alloc`) or `fbip` (no `result`, produces `into`). `Alloc` for standalone allocation. `Call` with `CallTarget` (direct | indirect). Shift/reset uses only Alloc, Read, Jump — no dedicated continuation instructions.
- **Terminators** — `Jump`, `Branch`, `Return`. Resume is lowered to Read + Jump.
- **Shift/reset** — State machine via blocks and jumps; heap-allocated frame capture for multi-shot; Option A (compile-time block label) with path to Option B.
