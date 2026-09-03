---
name: create-plan
description: >-
  Canonical procedure for authoring and executing a Yap implementation plan under
  z-yap/resources/plans/: plan shape, z-yap tracking (thread/queue/zettels/paper trail/session
  zettel), verification, and close-out reconciliation. Apply when the user asks for a plan,
  phased work, or a feature/refactor broken into milestones.
---

# Yap implementation plan (authoring & execution)

The canonical procedure for plan authoring and execution. Rationale and design history belong in z-yap zettels (tagged `meta`/`process`); they link back here — don't duplicate this checklist there.

## When to use

- A new or existing plan under `z-yap/resources/plans/`.
- Executing an existing plan end-to-end or step by step.
- The user wants code plus the z-yap tracking that goes with it (zettels, queue, thread, session zettel).

## Companion material

- **Plan shape**: copy `z-yap/resources/plans/_TEMPLATE.plan.md`.
- **Knowledge-base writes** (zettels, thread, queue, ADRs, session close-out): the **zettelkasten** skill (`z-yap/.cursor/skills/zettelkasten/SKILL.md`).
- **Context**: `AGENTS.md`, `.github/copilot-instructions.md`.
- **Coding & interaction**: `.cursor/rules/coding-style.mdc`, `.cursor/rules/pattern-matching.mdc`, `.cursor/rules/agent-behavior.mdc`.

## Agent behavior (non-negotiable)

- **Do not assume** user intent; **do not guess**. If unclear, **stop and ask**.
- **Stop and ask** if specs conflict, are ambiguous, or the work would need large **unplanned** design not in the plan or its linked zettels/ADRs.
- Honor the **Review policy** in the plan (pause after each todo/milestone when set).

## Authoring

1. Ground in the design space: `node z-yap/scripts/current-state.js`, `node z-yap/scripts/catalog.js --search <topic>`, and the relevant thread hub (`node z-yap/scripts/neighborhood.js <slug>`).
2. Copy `z-yap/resources/plans/_TEMPLATE.plan.md` → a new `z-yap/resources/plans/<topic>.plan.md`.
3. Fill **Out of scope** vs **Deferred work**, **Acceptance criteria**, and milestones in the YAML `todos` (add extra implementation todos as needed).
4. Wire tracking early: add a milestone/implementation zettel (concept or design zettel for the work, per the zettelkasten skill) and add items to the relevant thread or `global-pending-queue`. Cross-link the plan topic to its hub and design zettels.
5. **Review policy** — set to **incremental review** (stop after each todo/milestone) unless told otherwise.

## Executing

1. Sync the thread/queue items with plan todos; mark items `[x]` as they complete.
2. Implement focused diffs; follow existing patterns (style: `.cursor/rules/coding-style.mdc`, `pattern-matching.mdc`).
3. **Verification** per the plan body and project workflow:
   - `pnpm test` (Vitest; `pnpm test -u` to update snapshots, `pnpm test <path>` for a file). Ask before running broad suites (`.cursor/rules/agent-behavior.mdc`).
   - `pnpm lint` before considering work done.
   - `pnpm yap <file>.yap` (or `pnpm yap repl`) to exercise behavior end-to-end.
   - After grammar changes: `pnpm nearley` (the Nearley grammar is the only in-repo parser build).
   - Assess V2-migration impact when touching elaboration/inference/checking/parsing (`brainstorming/yap/V2-MIGRATION.md`).
4. Append a **session block** to `z-yap/thread.md` (`RESOLVED`/`SPAWN`/`ENQUEUE`, edges) — per the zettelkasten skill.
5. Create or update a **session zettel** for substantial design work (`refs: session:<uuid>`, `PRODUCED` links; `INCLUDES` from `[[sessions.hub]]`).
6. Close-out the design space: thread/member tags and `connections.md`, `node z-yap/scripts/adrs.js` for any new ADR, queue `[x]`.
7. **Zettelkasten reconciliation** — summarize what shipped vs the plan; compare code and design-space state to every relevant zettel. **List discrepancies** (stale tags, wrong connections, behavior vs zettel mismatch, missing ADR links).
8. **New zettels** — propose any notes that should exist; **get user confirmation** on which to create and naming before writing files.

## Do not

- Skip design-space lookups for non-trivial language semantics (check z-yap first; see `.github/copilot-instructions.md` § _Codebase awareness_).
- Silently widen scope or conflate **out of scope** with **deferred work**.
- Mix `z-yap/` edits into yap-implementation commits — z-yap is a nested git repository.
