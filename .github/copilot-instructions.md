# Copilot Instructions

Agent instructions for this repository are centralized — this file is only a pointer and is intentionally not maintained as a separate copy.

Read, in order:

1. [`/AGENTS.md`](../AGENTS.md) — canonical entry point: what Yap is, where design knowledge lives (`z-yap/`), the session contract (start / during / close-out), and the rule routing table.
2. [`.cursor/rules/*.mdc`](../.cursor/rules/) — the detailed behavioral and style rules: `coding-style`, `pattern-matching`, `conventions`, `testing`, `agent-behavior`, `session-start`. Load the ones relevant to your task per AGENTS.md's routing table.

The rules hold the detail. Keep all three in sync with code and design reality (see `agent-behavior.mdc` § Instruction self-maintenance).
