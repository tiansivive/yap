---
name: load
description: Load full Yap project and z-yap design-space state, and become aware of the support files and procedure skills for working in the knowledge base.
disable-model-invocation: true
user-invocable: true
---

# Load Yap + z-yap context

Load the current state of the project and its design-space zettelkasten (z-yap), and surface the support files and procedure skills that govern work in the knowledge base. This skill loads state and awareness — it is not the session/interaction protocol. That lives in the **zettelkasten** skill.

All paths are relative to the yap repo root unless noted.

## Read in order

Follow links recursively until you have a complete picture; do not stop at the first file.

1. `AGENTS.md` — project overview, key references, style summary, rule index.
2. `.github/copilot-instructions.md` — architecture, build/test, testing patterns, V2 migration, agent interaction style. Follow its pointers into `.cursor/rules/*.mdc` (coding-style, pattern-matching, conventions, testing, agent-behavior, session-start).
3. `z-yap/init.md` — z-yap orientation and the map of skills and support files.
4. `z-yap/README.md` — federation model, zettel format, connection format, federation URIs.
5. `z-yap/REGISTRY.md` — tag and edge-label registry (the descriptive vocabulary).
6. Last session block of `z-yap/thread.md` (scroll to end) — what happened most recently.
7. All `meta` zettels — knowledge-base conventions and design-to-implementation pipeline:

```bash
node z-yap/scripts/catalog.js --tag meta
```

## Load design-space state

```bash
node z-yap/scripts/current-state.js     # composite: pulse + baseline + ADR roll-up + hub snapshot
node z-yap/scripts/status.js            # thread + queue summary
node z-yap/scripts/threads.js --pending # non-implemented items per thread
node z-yap/scripts/queue.js             # pending queue items
```

When the session targets a specific thread or topic, pull its neighborhood:

```bash
node z-yap/scripts/neighborhood.js <thread-slug>   # fuzzy slug match
```

## Procedure skills (be aware; read when the work comes up)

- **zettelkasten** (`z-yap/.cursor/skills/zettelkasten/SKILL.md`) — canonical procedure for all knowledge-base writes: creating/updating/connecting zettels, hubs and threads, ADRs, the paper trail, the queue, the **session/interaction workflow**, and the **quality theory** for zettel content.
- **zettel-quality-rework** (`z-yap/.cursor/skills/zettel-quality-rework/SKILL.md`) — phased campaign for reworking low-quality (IMPL-MAP / MIXED) zettels into durable design knowledge.
- **create-plan** (`.cursor/skills/create-plan/SKILL.md`) — authoring and executing implementation plans under `z-yap/resources/plans/`.
- **yap-reviewer** (`.cursor/skills/yap-reviewer/SKILL.md`) — code review for the yap implementation.

## Confirm

After reading, confirm full context with a brief summary: current status, active threads, ADR state, and any open queue items relevant to the user's intent. Surface contradictions between these docs and the actual code (per `.github/copilot-instructions.md` § _Instruction self-maintenance_).

## Interaction norms

Follow `.cursor/rules/agent-behavior.mdc` and `.github/copilot-instructions.md` § _Agent interaction style_: do not edit the repo in response to questions or meta feedback unless explicitly asked; confirm before substantive changes; surface contradictions rather than resolving them silently.
