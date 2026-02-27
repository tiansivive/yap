---
name: Terminology and Docs Consistency
overview: Fix the Call target terminology mismatch (use "indirect" consistently instead of "closure"), generalize testing.mdc so the reset rule applies to all passes, and ensure ARCHITECTURE.md documents that passes do not reset supplies.
todos: []
isProject: false
---

# Terminology and Docs Consistency

## 1. Call Target Terminology: Use "indirect" Consistently

**Decision:** Use **indirect** for the call target type (not "closure"). Rationale: backend-neutral, standard term for call-through-pointer; "closure" describes the source (what spawned the call), not the IR target tag.

**Places to update:**

- **[MIR-LOWERING.md](docs/MIR-LOWERING.md) §3.4** — The current stub has `{ type: "Call"; func: string; args: string[]; result: string }` (direct-only). Replace with the new shape:

```ts
  type CallTarget =
    | { type: "direct"; func: string }
    | { type: "indirect"; callee: string };
  | { type: "Call"; target: CallTarget; args: string[]; result: string }


```

Add a short note that Phase 1 uses `indirect` only; `direct` is reserved for future optimization.

- **[Plan](.cursor/plans/lower_functions_and_applications_d63c202b.plan.md)** — Audit for any "closure" used as the target tag:
  - Overview (line 3): "Call with tagged targets, closure support" — "closure support" refers to closure conversion (data layout), not the target. Consider clarifying: "Call with direct/indirect targets; closure conversion (fnptr + env)".
  - Decision table (line 40): Already says `direct` | `indirect`. Add explicit note in rationale: "Target tag is `indirect` (not `closure`); backend-neutral."
  - doc-mir todo (line 6): "Call target union" — ensure MIR-LOWERING update uses `direct | indirect` explicitly.
- **Conceptual mapping** in MIR-LOWERING.md (line 321): `Call(lower(f), [arg_val])` — when we add the Call section, describe that closure-derived calls lower to `Read __fn, __env` + `Call(indirect, fnVar, [envVar, ...args])`.

## 2. testing.mdc — Generalize Reset Rule

**Current state:** The file already has a generalized "Reset supplies before tests" bullet under General (lines 43–44) that applies to "any pass: parser, elaboration, lowering, verification."

**Action:** Remove any remaining lowering-specific framing. The rule should state:

- Compiler passes do NOT reset supplies (they produce globally unique names).
- Tests that need deterministic output (snapshots) must call `resetSupply()` / `resetId()` at test start (or in `beforeEach`).
- This applies regardless of which pass is under test.

No separate "Lowering tests" section for supply convention — it belongs in General.

## 3. ARCHITECTURE.md — Passes Do Not Reset

**Current state:** The "Supply and naming" section (lines 45–48) already states:

- Passes use global supplies for fresh names.
- **Passes do NOT reset supplies** — for incremental/multi-module compilation.
- Tests must reset when deterministic output is needed.
- Cross-reference: `.cursor/rules/testing.mdc`.

**Action:** Ensure the rationale is explicit: "Passes do NOT reset supplies — they produce globally unique names so that incremental or multi-module compilation works correctly." (Already present.) No change needed if this is in place.

## 4. Cross-References

- **context.ts** — Point to `docs/ARCHITECTURE.md` § Supply and naming (not lowering-specific).
- **MIR-LOWERING.md** § Supply convention — Keep the one-liner that defers to ARCHITECTURE.md.

---

## Summary of Edits

| File                        | Change                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| `docs/MIR-LOWERING.md`      | §3.4: Replace `Call { func }` with `Call { target: CallTarget }` where `CallTarget = direct             | indirect`; add Phase 1 note |
| `.cursor/plans/...plan.md`  | Overview: clarify "direct/indirect targets"; decision table: add "indirect not closure" note if helpful |
| `.cursor/rules/testing.mdc` | Verify General rule is pass-agnostic; remove lowering-specific supply text if any remains               |
| `docs/ARCHITECTURE.md`      | Verify "Supply and naming" is present and complete                                                      |
| `src/lowering/context.ts`   | Verify comment points to ARCHITECTURE.md                                                                |
