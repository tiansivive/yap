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
- **Verification**: Liquid refinements, SMT translation, Z3
- **Stack**: TypeScript (strict), pnpm, Vitest

Architecture: `docs/ARCHITECTURE.md`, `src/elaboration/ARCHITECTURE.md`, `docs/V2-MIGRATION.md`

## Dev environment

- Use `pnpm` for all commands (Node ≥ 18.3)
- Install z3: `brew install z3` (macOS)
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
- **V2 elaboration** in `inference.v2/`, `checking.v2/`; v1 deprecated

## PR instructions

- Title: `[<area>] <Description>`
- Run `pnpm lint` and `pnpm test` before committing
- Ensure tests pass and snapshots are updated if behavior changed

## Key references

| Topic                   | Location                          |
| ----------------------- | --------------------------------- |
| Full agent instructions | `.github/copilot-instructions.md` |
| Architecture            | `docs/ARCHITECTURE.md`            |
| V2 migration            | `docs/V2-MIGRATION.md`            |
| MIR / lowering          | `docs/MIR-LOWERING.md`            |
| Design specs, roadmap   | `brainstorming/yap/`              |
| Cursor rules            | `.cursor/rules/*.mdc`             |

Lowering (`src/lowering/`): Lit, Var, prim App, Struct/Proj/Inj, Lambda (closure conversion), App (indirect), Match, Block, Reset/Shift. Shift/reset in `delimited_continuation/` (Alloc + Read + Jump, multishot: Branch + resume blocks). Returns `Module`. See MIR-LOWERING.md §5, §7.6.
