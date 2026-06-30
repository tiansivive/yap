# Yap — Agent Instructions

Yap is a dependently typed language with structural (row) types, implicits, and verification via modalities (QTT multiplicities + liquid refinements). Pipeline: Nearley parse → bidirectional V2 elaboration (NbE + unification) → IVL + in-tree CDCL(T) verification → `EB.Term → GRAM → MIR → codegen` (JS/C shipped, Erlang planned).

Stack: TypeScript (strict), pnpm, Vitest. Build, test, and dev setup: [.github/DEVELOPMENT.md](.github/DEVELOPMENT.md).

This file is the canonical entry point for any AI agent and is self-sufficient on its own. Detailed behavioral and style rules live in `.cursor/rules/*.mdc` (loaded on demand — see the routing table). It supersedes scattered restatements; `.github/copilot-instructions.md` points here.

## Design knowledge lives in z-yap

`z-yap/` is the source of truth for Yap's design space — a federated zettelkasten of ~490 atomic design notes (zettels), architecture decision records (ADRs, `D-NNN`), and a thread/queue work layer with an append-only paper trail (`z-yap/thread.md`). It is not scratch notes.

- **Orientation**: `z-yap/init.md`. Conventions and vocabulary: `z-yap/README.md`, `z-yap/REGISTRY.md`. Project hub: `z-yap/zettels/yap.md`.
- **Code is the truth for what runs; z-yap is the truth for why and what's decided.** When they disagree, surface it — do not silently reconcile.
- **Don't reinvent or re-litigate.** A topic is likely already tracked. Check before proposing, and check for `superseded` / `rejected` / `deprecated` zettels and `SUPERSEDES` / `REJECTS` edges — never re-propose a settled-and-dropped idea without acknowledging why it was dropped and what changed.

## Session contract

Applies to every working session, whether or not `/load` was invoked.

**Start**

- Run the **`/load`** skill (`.cursor/skills/load/`, also `.claude/skills/load/`) — loads project + z-yap state and surfaces the procedure skills. Most sessions begin here.
- If you skip `/load`, you are still bound by everything below. At minimum, read `z-yap/init.md` and the rule(s) for the work at hand.

**During**

- **Consult the rule(s) for the task before acting** — see the routing table below. In Cursor these auto-load every prompt (`alwaysApply`); other agents must open them.
- **Hold the posture in `agent-behavior.mdc`**: collaborative on implementation (ask, validate, surface contradictions, don't guess or silently retry); independent and grounded in design discussion (lead with analysis, hold positions with justification, resist sycophancy, don't mirror).
- **Proactively bring cross-cutting ideas** you weren't asked for: fitting concerns and solutions from within the project (grounded in z-yap) _and_ from outside it — analogous problems and transferable techniques from adjacent or entirely unrelated fields. Surface them; don't wait to be asked.
- **Enqueue future work**: when discussion surfaces work beyond the current task, create a z-yap queue item and tell the user.

**Close-out** (non-optional for substantive sessions)

- Record the session in z-yap per the **zettelkasten** skill (`z-yap/.cursor/skills/zettelkasten/`): new or updated zettels, status/maturity changes, connections, queue updates, and a `thread.md` session block. A session that moved understanding or code forward but left no z-yap trace is incomplete.

## Rule routing — load detail on demand

The detailed source is `.cursor/rules/*.mdc`. Consult by task:

| When you are…                             | Load                                                          |
| ----------------------------------------- | ------------------------------------------------------------- |
| writing or editing TypeScript             | `coding-style.mdc`, `pattern-matching.mdc`, `conventions.mdc` |
| writing or changing tests                 | `testing.mdc`                                                 |
| in a design / exploration discussion      | `agent-behavior.mdc` (design posture)                         |
| unsure how to interact or behave          | `agent-behavior.mdc`                                          |
| writing to z-yap or closing out a session | zettelkasten skill (`z-yap/.cursor/skills/zettelkasten/`)     |
| authoring a phased implementation plan    | create-plan skill (`.cursor/skills/create-plan/`)             |
| reviewing Yap code                        | yap-reviewer skill (`.cursor/skills/yap-reviewer/`)           |

## Key references

| Topic                           | Location                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| Design space (source of truth)  | `z-yap/` — start at `z-yap/init.md`                                                           |
| Build / test / dev setup        | `.github/DEVELOPMENT.md`                                                                      |
| Contributing & PR shape         | `.github/CONTRIBUTING.md`                                                                     |
| Architecture & decisions        | `z-yap/zettels/yap.md`, ADRs (`*.adr.md`, `D-NNN`)                                            |
| GRAM / MIR lowering             | `z-yap/zettels/gram-canonical-ir.adr.md`, `gram-to-mir-bridge`, `shift-reset-bridge-lowering` |
| Design specs, sketches, roadmap | `brainstorming/yap/`                                                                          |

PR titles follow `[<area>] <Description>`; PR bodies are _why + how to test_ (see CONTRIBUTING.md).
