# Yap — AI Agent Instructions

Yap is a dependently typed language with structural types, implicits, and verification semantics. This file guides AI coding agents working on the codebase.

**For full context**, read `.github/copilot-instructions.md` at session start. It covers architecture, detailed guidelines, testing patterns, V2 migration, and agent interaction style.

**Session start (recommended):** At the start of a new chat, @-mention these files so the agent has them in context:

```
@AGENTS.md @.github/copilot-instructions.md @.cursor/rules/coding-style.mdc @.cursor/rules/pattern-matching.mdc
```

Then ask the agent to read and apply them for the session. This ensures the guidelines are always followed.

**Cursor rules** (`.cursor/rules/`) encode style and conventions; they apply automatically when editing matching files:

| Rule                   | Applies                        | Content                                                   |
| ---------------------- | ------------------------------ | --------------------------------------------------------- |
| `session-start.mdc`    | always                         | Read guidelines at session start; apply from the start    |
| `agent-behavior.mdc`   | always                         | Collaborative, validate, surface issues, self-maintenance |
| `coding-style.mdc`     | always                         | Immutable, terse, V2 Do, recursion, map/reduce            |
| `pattern-matching.mdc` | always                         | ts-pattern with const pattern objects; no if checks       |
| `conventions.mdc`      | always                         | Path aliases, pitfalls, tree-sitter, v2                   |
| `testing.mdc`          | `**/__tests__/**`, `*.test.ts` | Parser, elaboration, module test patterns                 |

## Project overview

- **Parser**: Nearley (legacy) + tree-sitter (v2 migration in progress)
- **Elaboration**: Bidirectional inference, NbE, constraint solving via unification
- **Verification**: Liquid refinements, IVL, in-tree CDCL(T), validity discharge
- **Stack**: TypeScript (strict), pnpm, Vitest

Architecture and design authority live in `z-yap/` plus source paths. Start with `z-yap/init.md`, `z-yap/zettels/yap.md`, and the relevant thread hubs.

## Dev environment

- Use `pnpm` for all commands (Node ≥ 18.3)
- Path aliases: `@yap/elaboration/*`, `@yap/src/*`, `@yap/shared/*` (see `tsconfig.json`)
- After editing `src/parser/grammar.ne` → `pnpm nearley`
- After grammar changes in tree-sitter-yap → `pnpm ts-dts`

## Build and run

```bash
pnpm install
pnpm nearley           # Regenerate parser (if grammar changed)
pnpm yap < file > .yap # Parse, elaborate, verify
pnpm yap repl          # Interactive REPL
```

Do not use `pnpm build` while debugging; run `pnpm yap` directly.

## Testing

- Run: `pnpm test` | Update snapshots: `pnpm test -u` | Specific: `pnpm test <path>`
- Before committing: `pnpm lint` and `pnpm test`
- **Parser**: `ParserStart = "Ann"`; assert `data.results.length === 1`; snapshot `data.results[0]`
- **Elaboration**: `elaborateFrom(src)` from `util.ts`; reset supplies; assert on `structure` first, then snapshots
- Add or update tests for code you change

## Style guide (summary)

- **Immutable**, declarative, recursion over loops
- **Namespace-based APIs** — `Category.action` over `actionCategory`
- **V2 Do notation**; avoid long fp-ts pipelines
- **ts-pattern** with const pattern objects (no if checks, no predicate helpers)
- **One-word names**; small functions; KISS/DRY
- **Comments explain "why"**, not "what"
- **Design sessions**: independent analysis, hold positions, bring PL theory, ground in z-yap; do not defer or mirror
- **V2 elaboration** in `inference.v2/`, `checking.v2/`; v1 deprecated

## PR instructions

- Title: `[<area>] <Description>`
- Run `pnpm lint` and `pnpm test` before committing
- Ensure tests pass and snapshots are updated if behavior changed

## Key references

| Topic                   | Location                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Full agent instructions | `.github/copilot-instructions.md`                                                  |
| Architecture            | `z-yap/zettels/yap.md`                                                             |
| V2 migration            | `brainstorming/yap/V2-MIGRATION.md`                                                |
| GRAM / MIR lowering     | `z-yap/zettels/gram-evolution.thread.md`, `z-yap/zettels/gram-canonical-ir.adr.md` |
| Design specs, roadmap   | `brainstorming/yap/`                                                               |
| Cursor rules            | `.cursor/rules/*.mdc`                                                              |

Lowering: canonical compilation flows EB.Term -> GRAM -> MIR -> codegen. See `z-yap/zettels/gram-canonical-ir.adr.md`, `z-yap/zettels/gram-to-mir-bridge.md`, and `z-yap/zettels/shift-reset-bridge-lowering.md`.
