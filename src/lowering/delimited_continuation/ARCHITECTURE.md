# Delimited Continuation Lowering

Shift/reset lowering to MIR using only `Alloc`, `Read`, and `Jump`. No dedicated continuation instructions.

## Data Flow

```
lower(Reset(term))
  → lowerReset(term, ctx, lower)
  → lowerInReset traverses; on Shift → lowerShift
  → lowerShift: alloc env + k_ref, build shift_body + L_cont blocks

lower(App(k, v)) when k is continuation
  → lowerContinuationApp
  → emitResume: Read(__env) + Jump L_cont
```

## Continuation Layout

- `k_ref` = `Alloc { __env: envRef }`
- `envRef` = `Alloc { v0, v1, ... }` (captured vars)
- Resume: `Read("__env", k_ref, envRef)` then `Jump L_cont(v, envRef)`

## Elaboration Expectations

- `Reset(term)` — term may contain `Shift` and `App(k, v)` (resume)
- `Shift(body)` — body = `Lambda(k, e)`; k is Continuation binder
- Resume = `App(k, v)` — no separate EB.Resume constructor

If elaboration does not output these shapes, lowering will throw. See MIR-LOWERING.md §7.9.

## Shift Outside Reset

**Current:** Lowering throws "Shift without enclosing reset" when `Shift` appears outside a `Reset`.

**Should `\x -> shift k -> k 0` be valid?** Yes, in principle. The effect system would type it as a function that requires a reset (or effect handler) when called. The caller would need to either:

- Wrap the call in `reset { ... }`, or
- Propagate the effect (the function type would carry the effect in its row).

**Why we reject it today:** Lowering needs a `resetExit` label and `resetCtx` to build the continuation blocks. Without an enclosing reset, there is no `reset_exit` to jump to. The continuation would need to "escape" — it would be a value returned from the lambda. That requires Option B (first-class block refs, indirect jump) or a different representation (e.g. trampoline, runtime support).

**Path forward:** Elaboration would need to ensure `Shift` only appears under `Reset` (or under an effect handler that provides the delimiter). Alternatively, support escaping continuations via Option B. For now, we require explicit `reset` and document the limitation.

## Files

- `types.ts` — ResetCtx, ContinuationInfo
- `reset.ts` — lowerReset, lowerInReset
- `shift.ts` — lowerShift, allocContinuation, emitResume, isContinuationApp
- `index.ts` — public API
